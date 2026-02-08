// === controllers/passwordResetController.js ===
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import VerificationToken from "../models/VerificationToken.js";
import SystemSettings from "../models/SystemSettings.js";
import {
  sendPasswordResetEmail,
  sendPasswordResetSuccessEmail,
} from "../services/emailService.js";

/**
 * Step 1: Request password reset - sends verification code
 * POST /api/auth/forgot-password
 */
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ msg: "L'adresse email est requise." });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Find user by email
    const user = await User.findOne({ email: normalizedEmail });

    // Always return success message to prevent email enumeration
    const successMessage =
      "Si cette adresse email est associée à un compte, vous recevrez un code de vérification.";

    if (!user) {
      // Don't reveal that the user doesn't exist
      return res.json({ msg: successMessage });
    }

    // Check if user account is banned
    if (user.accountStatus === "banned") {
      return res.json({ msg: successMessage });
    }

    // Create password reset token with rate limiting
    const result = await VerificationToken.createPasswordResetToken(user._id);

    if (!result.success) {
      return res.status(429).json({
        msg: result.error,
        retryAfter: result.retryAfter,
      });
    }

    // Get email mode
    const verificationMode = await SystemSettings.getSetting(
      "email_verification_mode",
      "development",
    );

    console.log(`📧 Password reset - Mode: ${verificationMode}`);

    if (verificationMode === "smtp") {
      try {
        await sendPasswordResetEmail(user.email, result.code, user.nom);
        console.log(`✅ Password reset email sent to ${user.email}`);
      } catch (emailError) {
        console.error("❌ Failed to send password reset email:", emailError);
        // Don't expose email sending errors to the user
      }
    } else {
      console.log(
        `\n📧 [DEV MODE] Password reset code for ${user.email}: ${result.code}\n`,
      );
    }

    res.json({
      msg: successMessage,
      // Only include these in development
      ...(verificationMode === "development" && {
        devInfo: {
          code: result.code,
          expiresAt: result.expiresAt,
          requestsRemaining: result.requestsRemaining,
        },
      }),
    });
  } catch (err) {
    console.error("Forgot password error:", err);
    res
      .status(500)
      .json({ msg: "Une erreur est survenue. Veuillez réessayer." });
  }
};

/**
 * Step 2: Verify the code
 * POST /api/auth/verify-reset-code
 */
export const verifyResetCode = async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ msg: "Email et code requis." });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Find user
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(400).json({
        msg: "Code invalide ou expiré.",
      });
    }

    // Check development mode
    const verificationMode = await SystemSettings.getSetting(
      "email_verification_mode",
      "development",
    );

    let verificationResult;

    if (verificationMode === "development" && code === "123456") {
      // In development mode, accept 123456
      const token = await VerificationToken.findOne({
        userId: user._id,
        type: "password_reset",
      });

      if (!token) {
        return res.status(400).json({
          msg: "Aucune demande de réinitialisation en cours. Veuillez en faire une nouvelle.",
        });
      }

      verificationResult = {
        valid: true,
        token: token.token,
      };
    } else {
      // Normal verification
      verificationResult = await VerificationToken.verifyCode(
        user._id,
        code,
        "password_reset",
      );
    }

    if (!verificationResult.valid) {
      return res.status(400).json({
        msg: verificationResult.error,
        attemptsRemaining: verificationResult.attemptsRemaining,
        locked: verificationResult.locked,
      });
    }

    // Return the reset token for the next step
    res.json({
      msg: "Code vérifié avec succès.",
      resetToken: verificationResult.token,
    });
  } catch (err) {
    console.error("Verify reset code error:", err);
    res
      .status(500)
      .json({ msg: "Une erreur est survenue. Veuillez réessayer." });
  }
};

/**
 * Step 3: Reset the password
 * POST /api/auth/reset-password
 */
export const resetPassword = async (req, res) => {
  try {
    const { resetToken, newPassword, confirmPassword } = req.body;

    if (!resetToken || !newPassword) {
      return res.status(400).json({
        msg: "Token de réinitialisation et nouveau mot de passe requis.",
      });
    }

    // Validate password
    if (newPassword.length < 8) {
      return res.status(400).json({
        msg: "Le mot de passe doit contenir au moins 8 caractères.",
      });
    }

    if (!/[a-z]/.test(newPassword)) {
      return res.status(400).json({
        msg: "Le mot de passe doit contenir au moins une lettre minuscule.",
      });
    }

    if (!/[A-Z]/.test(newPassword)) {
      return res.status(400).json({
        msg: "Le mot de passe doit contenir au moins une lettre majuscule.",
      });
    }

    if (!/\d/.test(newPassword)) {
      return res.status(400).json({
        msg: "Le mot de passe doit contenir au moins un chiffre.",
      });
    }

    if (confirmPassword && newPassword !== confirmPassword) {
      return res.status(400).json({
        msg: "Les mots de passe ne correspondent pas.",
      });
    }

    // Verify the reset token
    const tokenResult = await VerificationToken.verifyResetToken(resetToken);

    if (!tokenResult.valid) {
      return res.status(400).json({
        msg: tokenResult.error,
      });
    }

    // Find the user
    const user = await User.findById(tokenResult.userId);

    if (!user) {
      return res.status(400).json({
        msg: "Utilisateur introuvable.",
      });
    }

    // Check if new password is same as old
    const isSamePassword = await bcrypt.compare(newPassword, user.motDePasse);
    if (isSamePassword) {
      return res.status(400).json({
        msg: "Le nouveau mot de passe doit être différent de l'ancien.",
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update password
    user.motDePasse = hashedPassword;
    user.emailVerified = true;
    await user.save();

    // Consume (delete) the reset token
    await VerificationToken.consumeResetToken(resetToken);

    // Send confirmation email
    const verificationMode = await SystemSettings.getSetting(
      "email_verification_mode",
      "development",
    );

    if (verificationMode === "smtp") {
      try {
        await sendPasswordResetSuccessEmail(user.email, user.nom);
      } catch (emailError) {
        console.error(
          "Failed to send password reset success email:",
          emailError,
        );
      }
    } else {
      console.log(
        `\n📧 [DEV MODE] Password reset successful for ${user.email}\n`,
      );
    }

    res.json({
      msg: "Votre mot de passe a été réinitialisé avec succès. Vous pouvez maintenant vous connecter.",
    });
  } catch (err) {
    console.error("Reset password error:", err);
    res
      .status(500)
      .json({ msg: "Une erreur est survenue. Veuillez réessayer." });
  }
};

/**
 * Check reset token validity (optional endpoint for frontend)
 * GET /api/auth/check-reset-token/:token
 */
export const checkResetToken = async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({ valid: false });
    }

    const result = await VerificationToken.verifyResetToken(token);

    res.json({
      valid: result.valid,
      ...(result.valid && {
        expiresAt: result.expiresAt,
      }),
    });
  } catch (err) {
    res.status(500).json({ valid: false });
  }
};

export default {
  forgotPassword,
  verifyResetCode,
  resetPassword,
  checkResetToken,
};
