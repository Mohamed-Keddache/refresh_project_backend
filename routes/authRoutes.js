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

// Controllers
import {
  register,
  login,
  verifyEmail,
  resendConfirmationCode,
  changeEmail,
  getCompanies,
  changePassword,
  getPasswordStatus,
  logoutAllDevices,
  deleteMyAccount,
  setPassword,
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

// ─────────────────────────────────────────────────────────
// PUBLIC ROUTES
// ─────────────────────────────────────────────────────────
router.post("/register", authRateLimiter, validators.register, register);
router.post("/login", authRateLimiter, validators.login, login);

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
router.get("/companies", getCompanies);

// ─────────────────────────────────────────────────────────
// OAUTH PUBLIC
// ─────────────────────────────────────────────────────────
router.post("/google/token", authRateLimiter, googleTokenLogin);
router.post("/facebook/token", authRateLimiter, facebookTokenLogin);

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
    failureRedirect: `${
      process.env.FRONTEND_URL || "http://localhost:3000"
    }/auth/oauth-error`,
  }),
  oauthCallbackHandler("google"),
);

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
    failureRedirect: `${
      process.env.FRONTEND_URL || "http://localhost:3000"
    }/auth/oauth-error`,
  }),
  oauthCallbackHandler("facebook"),
);

// ─────────────────────────────────────────────────────────
// PROTECTED ROUTES
// ─────────────────────────────────────────────────────────
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

router.delete("/delete-account", auth, authRateLimiter, deleteMyAccount);

// ─── PASSWORD MANAGEMENT ───
router.get("/password-status", auth, getPasswordStatus);
router.put("/set-password", auth, validators.setPassword, setPassword);

router.put(
  "/change-password",
  auth,
  authRateLimiter,
  validators.changePassword,
  changePassword,
);

router.post("/logout-all-devices", auth, logoutAllDevices);

// ─── OAUTH (PROTECTED) ───
router.get("/oauth/linked-providers", auth, getLinkedProviders);

router.delete("/oauth/unlink/:provider", auth, unlinkProvider);

router.post(
  "/oauth/complete-recruiter-setup",
  auth,
  completeOAuthRecruiterSetup,
);

export default router;
