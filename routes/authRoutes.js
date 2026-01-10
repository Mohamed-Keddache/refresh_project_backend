import express from "express";
import auth from "../middleware/auth.js";
import {
  register,
  login,
  verifyEmail,
  resendConfirmationCode,
  changeEmail,
  getCompanies,
} from "../controllers/authController.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);

router.post("/verify-email", auth, verifyEmail);
router.post("/resend-code", auth, resendConfirmationCode);
router.put("/change-email", auth, changeEmail);

router.get("/companies", getCompanies);

export default router;
