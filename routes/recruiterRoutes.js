import express from "express";
import auth from "../middleware/auth.js";
import { optionalAuth } from "../middleware/optionalAuth.js";
import { authRole } from "../middleware/roles.js";
import { requireEmailVerification } from "../middleware/requireEmailVerification.js";
// AJOUT : uploadAttachments ici
import { uploadImage, uploadAttachments } from "../config/multer.js";

// === ANCIENS CONTROLLERS ===
import {
  getRecruiterById,
  createOffer,
  getMyOffers,
  updateOffer,
  deactivateOffer,
  updateRecruiterProfile,
  updateCompanyDetails,
  getRecruiterDashboard,
  getRecruiterProfileEndpoint,
  getCompanyTeam,
  getOfferStats,
  submitValidationResponse,
  getCandidateFullProfile,
  getMyOffersWithStats,
  getRecruiterOfferDetails,
} from "../controllers/recruiterController.js";

// === NOUVEAUX CONTROLLERS ===
import {
  getOfferApplications, // La nouvelle version
  //getAllApplications,
  markAsSeen,
  updateRecruiterStatus,
  toggleStarred,
  updateNotes,
  getAllApplicationsAdvanced,
  markAllOfferApplicationsAsSeen,
} from "../controllers/recruiterApplicationController.js";

import {
  proposeInterview,
  getRecruiterInterviews,
  acceptAlternativeDate,
  rescheduleByRecruiter,
  cancelInterviewByRecruiter,
  completeInterview,
  getRecruiterInterviewsGrouped,
} from "../controllers/interviewController.js";

import {
  getRecruiterConversations,
  openConversation,
  sendMessageAsRecruiter,
  getRecruiterConversationMessages,
} from "../controllers/conversationController.js";

const router = express.Router();

// Routes publiques
router.get("/public/:id", optionalAuth, getRecruiterById);

// Middleware Auth
router.use(auth, authRole(["recruteur"]));

// --- ROUTES GESTION COMPTE & OFFRES (Inchangées) ---
router.get("/profile", getRecruiterProfileEndpoint);
router.put("/profile", updateRecruiterProfile);
router.get("/candidates/:candidateId", getCandidateFullProfile);
router.get("/dashboard", getRecruiterDashboard);

router.post(
  "/validation-response",
  uploadAttachments.array("documents", 5),
  submitValidationResponse,
);

router.post("/offers", requireEmailVerification, createOffer);
router.get("/my-offers", getMyOffers);
router.get("/offers/:id", getRecruiterOfferDetails);
router.put("/offers/:id", updateOffer);
router.put("/offers/:id/deactivate", deactivateOffer);
router.get("/offers/:offerId/stats", getOfferStats);

router.put("/company", updateCompanyDetails);
router.get("/company/team", getCompanyTeam);

// 1. Candidatures (Gestion avancée)
router.get("/offers/:offerId/applications", getOfferApplications); // Nouvelle version riche
//router.get("/applications", getAllApplications); legacy
router.get("/applications/advanced", getAllApplicationsAdvanced);
router.put("/applications/:applicationId/seen", markAsSeen);
router.put("/applications/:applicationId/status", updateRecruiterStatus); // Nouvelle méthode (workflow complet)
router.put("/applications/:applicationId/star", toggleStarred);
router.put("/applications/:applicationId/notes", updateNotes);

// 2. Entretiens (Modèle Interview)
router.get("/interviews/grouped", getRecruiterInterviewsGrouped);
router.get("/interviews", getRecruiterInterviews);
router.post("/applications/:applicationId/interviews", proposeInterview);
router.put(
  "/interviews/:interviewId/accept-alternative",
  acceptAlternativeDate,
);
router.put("/interviews/:interviewId/reschedule", rescheduleByRecruiter);
router.put("/interviews/:interviewId/cancel", cancelInterviewByRecruiter);
router.put("/interviews/:interviewId/complete", completeInterview);

// 3. Conversations
router.get("/conversations", getRecruiterConversations);
router.post("/applications/:applicationId/conversation", openConversation);
router.post(
  "/conversations/:conversationId/messages",
  uploadAttachments.array("attachments", 3),
  sendMessageAsRecruiter,
);

// Offres avec stats enrichies
router.get("/my-offers-stats", getMyOffersWithStats);

// Marquer toutes les candidatures d'une offre comme vues
router.put("/offers/:offerId/mark-all-seen", markAllOfferApplicationsAsSeen);

// Détail d'une conversation (messages)
router.get("/conversations/:conversationId", getRecruiterConversationMessages);
//router.get("/conversations/:conversationId", getRecruiterConversationDetail);

export default router;
