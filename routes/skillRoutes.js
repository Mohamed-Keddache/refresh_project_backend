import express from "express";
import { getSkills } from "../controllers/skillController.js";
import auth from "../middleware/auth.js";

const router = express.Router();

router.get("/", auth, getSkills);

export default router;
