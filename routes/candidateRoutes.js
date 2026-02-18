import express from "express";
import auth from "../middleware/auth.js";
import { authRole } from "../middleware/roles.js";
import { requireEmailVerification } from "../middleware/requireEmailVerification.js";
import { uploadRateLimiter } from "../middleware/security.js";
import { validators } from "../middleware/validate.js";
import {
  uploadCV,
  uploadImage,
  uploadAttachments,
  handleMulterError,
} from "../config/multer.js";

import {
  updateProfile,
  uploadProfilePicture,
  uploadCandidateCV,
  deleteCV,
  applyToOffer,
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
  getActivityTimeline,
  getRecommendedOffers,
} from "../controllers/candidateController.js";

import {
  getSkillDetails,
  submitSkillFeedback,
} from "../controllers/skillController.js";

import {
  getMyApplications,
  getApplicationDetail,
  withdrawApplication,
  cancelApplication,
  checkApplicationStatus,
} from "../controllers/candidateApplicationController.js";

import {
  getCandidateInterviews,
  acceptInterview,
  declineInterview,
  proposeAlternativeDate,
} from "../controllers/interviewController.js";

import {
  getCandidateConversations,
  getConversationMessages,
  sendMessageAsCandidate,
} from "../controllers/conversationController.js";

const router = express.Router();

router.use(auth, authRole(["candidat"]));

// Profile
router.get("/profil", getProfile);
router.put("/profil", validators.updateProfile, updateProfile);
router.put("/compte", updateAccount);
router.get("/stats", getCandidateStats);
router.get("/activity", getActivityTimeline);

// File uploads with rate limiting
router.post(
  "/upload-photo",
  uploadRateLimiter,
  uploadImage.single("photo"),
  handleMulterError,
  uploadProfilePicture,
);
router.post(
  "/upload-cv",
  uploadRateLimiter,
  uploadCV.single("cv"),
  handleMulterError,
  uploadCandidateCV,
);
router.delete("/delete-cv/:cvId", validators.mongoId("cvId"), deleteCV);

// Skills
router.post("/profil/skills", validators.addSkill, addSkill);
router.put(
  "/profil/skills/:skillId",
  validators.mongoId("skillId"),
  updateSkill,
);
router.delete(
  "/profil/skills/:skillId",
  validators.mongoId("skillId"),
  deleteSkill,
);

router.get(
  "/profil/skills/:skillId/details",
  validators.mongoId("skillId"),
  getSkillDetails,
);
router.post(
  "/profil/skills/:skillId/feedback",
  validators.mongoId("skillId"),
  submitSkillFeedback,
);

// Experience
router.post("/profil/experiences", validators.addExperience, addExperience);
router.put(
  "/profil/experiences/:experienceId",
  validators.mongoId("experienceId"),
  updateExperience,
);
router.delete(
  "/profil/experiences/:experienceId",
  validators.mongoId("experienceId"),
  deleteExperience,
);

// Education
router.post("/profil/education", validators.addEducation, addEducation);
router.put(
  "/profil/education/:educationId",
  validators.mongoId("educationId"),
  updateEducation,
);
router.delete(
  "/profil/education/:educationId",
  validators.mongoId("educationId"),
  deleteEducation,
);

// Favorites
router.get("/favorites", getFavorites);
router.post(
  "/favorites/:offerId",
  validators.mongoId("offerId"),
  addToFavorites,
);
router.delete(
  "/favorites/:offerId",
  validators.mongoId("offerId"),
  removeFromFavorites,
);

// Recommendations
router.get("/recommended-offers", getRecommendedOffers);

// Applications
router.post(
  "/postuler",
  requireEmailVerification,
  validators.applyToOffer,
  applyToOffer,
);
router.get(
  "/applications/check/:offerId",
  validators.mongoId("offerId"),
  checkApplicationStatus,
);
router.get("/applications", validators.pagination, getMyApplications);
router.get(
  "/applications/:applicationId",
  validators.mongoId("applicationId"),
  getApplicationDetail,
);
router.delete(
  "/applications/:applicationId",
  validators.mongoId("applicationId"),
  withdrawApplication,
);
router.delete(
  "/applications/:applicationId/cancel",
  validators.mongoId("applicationId"),
  cancelApplication,
);

// Interviews
router.get("/interviews", getCandidateInterviews);
router.put(
  "/interviews/:interviewId/accept",
  validators.mongoId("interviewId"),
  acceptInterview,
);
router.put(
  "/interviews/:interviewId/decline",
  validators.mongoId("interviewId"),
  declineInterview,
);
router.put(
  "/interviews/:interviewId/propose-date",
  validators.mongoId("interviewId"),
  proposeAlternativeDate,
);

// Conversations
router.get("/conversations", getCandidateConversations);
router.get(
  "/conversations/:conversationId",
  validators.mongoId("conversationId"),
  getConversationMessages,
);
router.post(
  "/conversations/:conversationId/messages",
  validators.mongoId("conversationId"),
  uploadAttachments.array("attachments", 3),
  handleMulterError,
  sendMessageAsCandidate,
);

export default router;
