import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Candidate from "../models/Candidate.js";
import Company from "../models/Company.js";
import Recruiter from "../models/Recruiter.js";
import VerificationToken from "../models/VerificationToken.js";
import SystemSettings from "../models/SystemSettings.js";
import {
  sendVerificationEmail,
  sendWelcomeEmail,
} from "../services/emailService.js";

const generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
      emailVerified: user.emailVerified,
    },
    process.env.JWT_SECRET,
    { expiresIn: "1d" },
  );
};

function getRecruiterStatusMessage(status) {
  const messages = {
    pending_validation:
      "Votre compte est en attente de validation par un administrateur.",
    pending_documents:
      "Des documents vous ont été demandés. Veuillez les fournir.",
    pending_info: "Des informations complémentaires vous ont été demandées.",
    pending_info_and_documents:
      "Des informations et des documents vous ont été demandés.",
    pending_revalidation: "Vos réponses sont en cours d'examen.",
  };
  return messages[status] || "Statut en attente.";
}

export const register = async (req, res) => {
  try {
    const { nom, email, motDePasse, role } = req.body;

    // Check if email already exists
    const exist = await User.findOne({ email: email.toLowerCase() });
    if (exist) {
      return res.status(400).json({ msg: "Email déjà utilisé" });
    }

    // Hash password
    const hash = await bcrypt.hash(motDePasse, 12);

    // Create user
    const user = await User.create({
      nom,
      email: email.toLowerCase(),
      motDePasse: hash,
      role,
      emailVerified: false,
      accountStatus: "active",
    });

    try {
      // Create role-specific profile
      if (role === "recruteur") {
        // Recruiter is created without company initially
        await Recruiter.create({
          userId: user._id,
          status: "incomplete", // will complete company info later
        });
      } else if (role === "candidat") {
        await Candidate.create({
          userId: user._id,
        });
      }

      // Send verification email
      const verificationMode = await SystemSettings.getSetting(
        "email_verification_mode",
        "development",
      );

      console.log(
        `📧 Registration - Email verification mode: ${verificationMode}`,
      );

      if (verificationMode === "smtp") {
        try {
          const { code } = await VerificationToken.createVerificationToken(
            user._id,
            "email_verification",
            15,
          );

          console.log(`📧 Sending verification email to ${user.email}`);
          await sendVerificationEmail(user.email, code, user.nom);
          console.log(`✅ Verification email sent successfully`);
        } catch (emailError) {
          console.error("❌ Failed to send verification email:", emailError);
          // Do not fail registration if email fails
        }
      } else {
        console.log(
          `📨 [DEV MODE] User Registered: ${user.email}. Use code: 123456`,
        );
      }

      const token = generateToken(user);

      return res.status(201).json({
        msg: "Inscription réussie. Vérifiez votre email.",
        token,
        user: {
          id: user._id,
          email: user.email,
          role: user.role,
          emailVerified: false,
        },
        needsEmailVerification: true,
      });
    } catch (err) {
      // Rollback user if profile creation fails
      await User.findByIdAndDelete(user._id);
      throw err;
    }
  } catch (err) {
    console.error("Registration error:", err);
    return res.status(500).json({ msg: err.message });
  }
};

export const login = async (req, res) => {
  try {
    const { email, motDePasse } = req.body;

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({ msg: "Utilisateur non trouvé" });
    }

    const ok = await bcrypt.compare(motDePasse, user.motDePasse);
    if (!ok) {
      return res.status(401).json({ msg: "Mot de passe incorrect" });
    }

    if (!user.canLogin()) {
      if (user.accountStatus === "banned") {
        return res.status(403).json({
          msg: "Votre compte a été banni. Veuillez contacter l'administrateur.",
          code: "ACCOUNT_BANNED",
        });
      }
      if (user.accountStatus === "suspended") {
        return res.status(403).json({
          msg: `Votre compte est suspendu${
            user.suspendedUntil
              ? ` jusqu'au ${user.suspendedUntil.toLocaleDateString("fr-FR")}`
              : ""
          }.`,
          code: "ACCOUNT_SUSPENDED",
          reason: user.suspensionReason,
        });
      }
    }

    if (user.role === "recruteur") {
      if (!user.emailVerified) {
        return res.status(403).json({
          msg: "Veuillez confirmer votre email avant de vous connecter.",
          code: "EMAIL_NOT_VERIFIED",
          needEmailVerification: true,
        });
      }

      const recruiter = await Recruiter.findOne({ userId: user._id });
      if (recruiter) {
        if (recruiter.status === "rejected") {
          return res.status(403).json({
            msg: "Votre compte recruteur a été refusé.",
            code: "RECRUITER_REJECTED",
            reason: recruiter.rejectionReason,
          });
        }

        if (recruiter.status !== "validated") {
          const token = generateToken(user);
          user.derniereConnexion = new Date();
          await user.save();

          return res.json({
            msg: "Connexion réussie (accès limité)",
            token,
            user: {
              id: user._id,
              nom: user.nom,
              email: user.email,
              role: user.role,
              emailVerified: user.emailVerified,
            },
            recruiterStatus: recruiter.status,
            limitedAccess: true,
            statusMessage: getRecruiterStatusMessage(recruiter.status),
          });
        }
      }
    }

    const token = generateToken(user);
    user.derniereConnexion = new Date();
    await user.save();

    res.json({
      msg: "Connexion réussie ✅",
      token,
      user: {
        id: user._id,
        nom: user.nom,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerified,
      },
      needsEmailVerification: !user.emailVerified,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const resendConfirmationCode = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ msg: "Utilisateur introuvable" });
    }

    if (user.emailVerified) {
      return res.status(400).json({ msg: "Email déjà vérifié" });
    }

    const verificationMode = await SystemSettings.getSetting(
      "email_verification_mode",
      "development",
    );

    console.log(
      `📧 Resend code - Email verification mode: ${verificationMode}`,
    );

    if (verificationMode === "smtp") {
      try {
        const { code, expiresAt } =
          await VerificationToken.createVerificationToken(
            user._id,
            "email_verification",
            15,
          );

        console.log(
          `📧 Sending new verification code to ${user.email}: ${code}`,
        );
        await sendVerificationEmail(user.email, code, user.nom);

        res.json({
          msg: "Code de confirmation envoyé 📨",
          expiresAt,
        });
      } catch (emailError) {
        console.error("❌ Failed to send verification email:", emailError);
        res.status(500).json({
          msg: "Erreur lors de l'envoi de l'email. Veuillez réessayer.",
          error:
            process.env.NODE_ENV !== "production"
              ? emailError.message
              : undefined,
        });
      }
    } else {
      console.log(
        `📨 [DEV MODE] Code de confirmation pour ${user.email}: 123456`,
      );
      res.json({
        msg: "Code de confirmation envoyé (Mode développement: utilisez 123456) 📨",
      });
    }
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const verifyEmail = async (req, res) => {
  try {
    const { code } = req.body;
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ msg: "Utilisateur introuvable" });
    }

    if (user.emailVerified) {
      return res.status(400).json({ msg: "Email déjà vérifié" });
    }

    const verificationMode = await SystemSettings.getSetting(
      "email_verification_mode",
      "development",
    );

    console.log(
      `📧 Verify email - Mode: ${verificationMode}, Code received: ${code}`,
    );

    let isValid = false;

    if (verificationMode === "development") {
      isValid = code === "123456";
      if (!isValid) {
        return res.status(400).json({
          msg: "Code incorrect. Utilisez 123456 en mode développement.",
        });
      }
    } else {
      const result = await VerificationToken.verifyCode(
        userId,
        code,
        "email_verification",
      );

      if (!result.valid) {
        return res.status(400).json({
          msg: result.error,
          attemptsRemaining: result.attemptsRemaining,
        });
      }
      isValid = true;
    }

    if (isValid) {
      user.emailVerified = true;
      await user.save();

      // Send welcome email (don't fail if this fails)
      try {
        await sendWelcomeEmail(user.email, user.nom);
      } catch (emailErr) {
        console.error("Failed to send welcome email:", emailErr);
      }

      const newToken = generateToken(user);

      return res.json({
        msg: "E-mail confirmé avec succès ! 🎉",
        token: newToken,
        user: {
          id: user._id,
          nom: user.nom,
          email: user.email,
          role: user.role,
          emailVerified: true,
        },
      });
    }
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const changeEmail = async (req, res) => {
  try {
    const { newEmail } = req.body;
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ msg: "Utilisateur introuvable" });
    }

    if (user.emailVerified) {
      return res.status(400).json({
        msg: "Impossible de changer l'email car il est déjà vérifié.",
      });
    }

    const normalizedEmail = newEmail.toLowerCase();
    const exist = await User.findOne({
      email: normalizedEmail,
      _id: { $ne: userId },
    });
    if (exist) {
      return res.status(400).json({ msg: "Cet email est déjà utilisé." });
    }

    user.email = normalizedEmail;
    await user.save();

    await VerificationToken.deleteMany({ userId, type: "email_verification" });

    res.json({
      msg: `Email mis à jour vers ${normalizedEmail}. Veuillez confirmer ce nouvel email.`,
      email: normalizedEmail,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getCompanies = async (req, res) => {
  try {
    const companies = await Company.find({ status: "active" })
      .select("_id name")
      .sort({ name: 1 })
      .lean();

    res.json(companies);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export default {
  register,
  login,
  verifyEmail,
  resendConfirmationCode,
  changeEmail,
  getCompanies,
};
