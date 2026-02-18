// routes/skillRoutes.js
import express from "express";
import {
  getSkills,
  getSkillProposalStatus,
  suggestSkills,
} from "../controllers/skillController.js";
import auth from "../middleware/auth.js";

const router = express.Router();

router.get("/", auth, getSkills);
router.get("/suggest", auth, suggestSkills);
router.get("/proposal-status", auth, getSkillProposalStatus);

export default router;
