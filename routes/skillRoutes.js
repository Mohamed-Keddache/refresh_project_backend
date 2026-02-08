import express from "express";
import {
  getSkills,
  getSkillProposalStatus,
} from "../controllers/skillController.js";
import auth from "../middleware/auth.js";

const router = express.Router();

router.get("/", auth, getSkills);
router.get("/proposal-status", auth, getSkillProposalStatus);

export default router;
