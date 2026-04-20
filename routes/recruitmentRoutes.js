//recruitmentRoutes.js
import express from "express";
import auth from "../middleware/auth.js";
import { authRole } from "../middleware/roles.js";
import { requireEmailVerification } from "../middleware/requireEmailVerification.js";
import { validators } from "../middleware/validate.js";
import AnemOffer from "../models/AnemOffer.js";

import {
  // Phase 1
  initiateContact,
  getPredefinedMessages,
  // Phase 2
  proposeInterview,
  forceNewInterview,
  // Phase 3
  acceptInterview,
  proposeAlternativeDate,
  declineInterview,
  // Phase 4
  cancelInterviewByRecruiter,
  cancelInterviewByCandidate,
  rescheduleByRecruiter,
  acceptAlternativeDate,
  markInterviewCompleted,
  // Phase 5
  submitInterviewFeedback,
  // Phase 6
  proposeHire,
  cancelHireOffer,
  acceptHire,
  declineHire,
  // Phase 7
  getOtherActiveApplications,
  withdrawAllOtherApplications,
  // Phase 9
  closeOffer,
  // Gestion embauchés
  getMyHires,
  removeHire,
} from "../controllers/recruitmentFlowController.js";

const router = express.Router();

// ============================================
// ROUTES RECRUTEUR
// ============================================
const recruiterAuth = [auth, authRole(["recruteur"])];

// Phase 1 : Premier contact
router.get("/predefined-messages", ...recruiterAuth, getPredefinedMessages);
router.post("/contact/:applicationId", ...recruiterAuth, initiateContact);

// Phase 2 : Proposer un entretien
router.post("/interviews/:applicationId", ...recruiterAuth, proposeInterview);
router.post(
  "/interviews/:applicationId/force",
  ...recruiterAuth,
  forceNewInterview,
);

// Phase 4 : Actions recruteur sur entretien
router.put(
  "/interviews/:interviewId/cancel-by-recruiter",
  ...recruiterAuth,
  cancelInterviewByRecruiter,
);
router.put(
  "/interviews/:interviewId/reschedule",
  ...recruiterAuth,
  rescheduleByRecruiter,
);
router.put(
  "/interviews/:interviewId/accept-alternative",
  ...recruiterAuth,
  acceptAlternativeDate,
);
router.put(
  "/interviews/:interviewId/mark-completed",
  ...recruiterAuth,
  markInterviewCompleted,
);

// Phase 5 : Feedback
router.post(
  "/interviews/:interviewId/feedback",
  ...recruiterAuth,
  submitInterviewFeedback,
);

// Phase 6 : Embauche (recruteur)
router.post("/hire/:applicationId", ...recruiterAuth, proposeHire);
router.put("/hire/:applicationId/cancel", ...recruiterAuth, cancelHireOffer);
router.put("/hire/:applicationId/remove", ...recruiterAuth, removeHire);

// Phase 9 : Clôture offre
router.post("/offers/:offerId/close", ...recruiterAuth, closeOffer);

// Gestion embauchés
router.get("/my-hires", ...recruiterAuth, getMyHires);

// ============================================
// ROUTES CANDIDAT
// ============================================
const candidateAuth = [auth, authRole(["candidat"])];

// Phase 3 : Réponse candidat à l'entretien
router.put(
  "/interviews/:interviewId/accept",
  ...candidateAuth,
  acceptInterview,
);
router.put(
  "/interviews/:interviewId/propose-alternative",
  ...candidateAuth,
  proposeAlternativeDate,
);
router.put(
  "/interviews/:interviewId/decline",
  ...candidateAuth,
  declineInterview,
);

// Phase 4 : Annulation par candidat
router.put(
  "/interviews/:interviewId/cancel-by-candidate",
  ...candidateAuth,
  cancelInterviewByCandidate,
);

// Phase 6 : Embauche (candidat)
router.put("/hire/:applicationId/accept", ...candidateAuth, acceptHire);
router.put("/hire/:applicationId/decline", ...candidateAuth, declineHire);

// Phase 7 : Nettoyage
router.get(
  "/my-other-applications",
  ...candidateAuth,
  getOtherActiveApplications,
);
router.post(
  "/withdraw-all-others",
  ...candidateAuth,
  withdrawAllOtherApplications,
);

export default router;
