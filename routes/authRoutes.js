// === routes/authRoutes.js ===
import express from "express";
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
} from "../controllers/authController.js";
import {
  forgotPassword,
  verifyResetCode,
  resetPassword,
  checkResetToken,
} from "../controllers/passwordResetController.js";

const router = express.Router();

// Registration & Login
router.post("/register", authRateLimiter, validators.register, register);
router.post("/login", authRateLimiter, validators.login, login);

// Email verification
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

// Password reset (Forgot password)
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

// Public
router.get("/companies", getCompanies);

export default router;
