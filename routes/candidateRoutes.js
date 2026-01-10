import express from "express";
import auth from "../middleware/auth.js";
import { authRole } from "../middleware/roles.js";
import { requireEmailVerification } from "../middleware/requireEmailVerification.js";
import { uploadCV, uploadImage } from "../config/multer.js";

import {
  updateProfile,
  uploadProfilePicture,
  uploadCandidateCV,
  deleteCV,
  applyToOffer,
  getHistorique,
  updateAccount,
  getProfile,
  addToFavorites,
  removeFromFavorites,
  getFavorites,
  addSkill,
  updateSkill,
  deleteSkill,
  addExperience,
  updateExperience,
  deleteExperience,
  addEducation,
  updateEducation,
  deleteEducation,
  getCandidateStats,
  getRecommendedOffers,
  confirmInterview,
} from "../controllers/candidateController.js";

const router = express.Router();

router.use(auth, authRole(["candidat"]));

router.get("/profil", getProfile);
router.put("/profil", updateProfile);
router.put("/compte", updateAccount);
router.get("/stats", getCandidateStats);

router.post("/upload-photo", uploadImage.single("photo"), uploadProfilePicture);
router.post("/upload-cv", uploadCV.single("cv"), uploadCandidateCV);
router.delete("/delete-cv/:cvId", deleteCV);

router.post("/profil/skills", addSkill);
router.put("/profil/skills/:skillId", updateSkill);
router.delete("/profil/skills/:skillId", deleteSkill);

router.post("/profil/experiences", addExperience);
router.put("/profil/experiences/:experienceId", updateExperience);
router.delete("/profil/experiences/:experienceId", deleteExperience);

router.post("/profil/education", addEducation);
router.put("/profil/education/:educationId", updateEducation);
router.delete("/profil/education/:educationId", deleteEducation);

router.post("/postuler", requireEmailVerification, applyToOffer);
router.get("/historique", getHistorique);
router.get("/favorites", getFavorites);
router.post("/favorites/:offerId", addToFavorites);
router.delete("/favorites/:offerId", removeFromFavorites);

router.get("/recommended-offers", getRecommendedOffers);

router.put("/applications/:applicationId/confirm-interview", confirmInterview);

export default router;
