import express from "express";
import passport from "passport";
import auth from "../middleware/auth.js";
import {
  authRateLimiter,
  emailVerificationLimiter,
  passwordResetLimiter,
  passwordResetVerifyLimiter,
} from "../middleware/security.js";
import { validators } from "../middleware/validate.js";
import {
  register,
  login,
  verifyEmail,
  resendConfirmationCode,
  changeEmail,
  getCompanies,
  changePassword,
  deleteMyAccount,
} from "../controllers/authController.js";
import {
  forgotPassword,
  verifyResetCode,
  resetPassword,
  checkResetToken,
} from "../controllers/passwordResetController.js";
import {
  googleTokenLogin,
  facebookTokenLogin,
  oauthCallbackHandler,
  completeOAuthRecruiterSetup,
  getLinkedProviders,
  unlinkProvider,
} from "../controllers/oauthController.js";

const router = express.Router();

// ─── Standard Auth ──────────────────────────────────────────────────
router.post("/register", authRateLimiter, validators.register, register);
router.post("/login", authRateLimiter, validators.login, login);

// ─── Email verification ─────────────────────────────────────────────
router.post(
  "/verify-email",
  auth,
  emailVerificationLimiter,
  validators.verifyEmail,
  verifyEmail,
);
router.post(
  "/resend-code",
  auth,
  emailVerificationLimiter,
  resendConfirmationCode,
);
router.put("/change-email", auth, validators.changeEmail, changeEmail);

// ─── Password reset ─────────────────────────────────────────────────
router.post(
  "/forgot-password",
  passwordResetLimiter,
  validators.forgotPassword,
  forgotPassword,
);
router.post(
  "/verify-reset-code",
  passwordResetVerifyLimiter,
  validators.verifyResetCode,
  verifyResetCode,
);
router.post(
  "/reset-password",
  passwordResetVerifyLimiter,
  validators.resetPassword,
  resetPassword,
);
router.get("/check-reset-token/:token", checkResetToken);

// Changement de mot de passe (utilisateur connecté)
router.post(
  "/change-password",
  auth,
  authRateLimiter,
  validators.changePassword,
  changePassword,
);

// Suppression de compte
router.delete("/delete-account", auth, authRateLimiter, deleteMyAccount);

// ─── Companies (for registration) ──────────────────────────────────
router.get("/companies", getCompanies);

// ═══════════════════════════════════════════════════════════════════════
//  OAUTH ROUTES
// ═══════════════════════════════════════════════════════════════════════

// ─── Google: Token-based (recommended for SPA / React) ──────────────
router.post("/google/token", authRateLimiter, googleTokenLogin);

// ─── Facebook: Token-based (recommended for SPA / React) ────────────
router.post("/facebook/token", authRateLimiter, facebookTokenLogin);

// ─── Google: Redirect-based (traditional OAuth flow) ────────────────
router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
  }),
);

router.get(
  "/google/callback",
  passport.authenticate("google", {
    session: false,
    failureRedirect: `${process.env.FRONTEND_URL || "http://localhost:3000"}/auth/oauth-error?error=google_failed`,
  }),
  oauthCallbackHandler("google"),
);

// ─── Facebook: Redirect-based (traditional OAuth flow) ──────────────
router.get(
  "/facebook",
  passport.authenticate("facebook", {
    scope: ["email"],
    session: false,
  }),
);

router.get(
  "/facebook/callback",
  passport.authenticate("facebook", {
    session: false,
    failureRedirect: `${process.env.FRONTEND_URL || "http://localhost:3000"}/auth/oauth-error?error=facebook_failed`,
  }),
  oauthCallbackHandler("facebook"),
);

// ─── OAuth account management ───────────────────────────────────────
router.post(
  "/oauth/complete-recruiter-setup",
  auth,
  completeOAuthRecruiterSetup,
);
router.get("/oauth/linked-providers", auth, getLinkedProviders);
router.delete("/oauth/unlink/:provider", auth, unlinkProvider);

export default router;
