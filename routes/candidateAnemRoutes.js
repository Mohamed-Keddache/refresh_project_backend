// routes/candidateAnemRoutes.js
import express from "express";
import auth from "../middleware/auth.js";
import { authRole } from "../middleware/roles.js";
import Admin from "../models/Admin.js";

// Candidate endpoints
import {
  getCandidateAnemStatus,
  markAnemInfoSeen,
  declineCandidateAnem,
  resetCandidateAnemDecline,
  submitCandidateAnemId,
  startCandidateRegistration,
  saveCandidateRegistrationStep,
  submitCandidateRegistration,
  getCandidateRegistrationForm,
  // Admin endpoints
  getCandidateAnemDemandes,
  getCandidateDemandeDetails,
  getCandidatePendingAnemIds,
  assignCandidateDemande,
  markCandidateDemandeInProgress,
  getCandidateAnemPdfData,
  approveCandidateAnemId,
  rejectCandidateAnemId,
  markCandidateRegistered,
  markCandidateAnemFailed,
  addCandidateAnemAdminNote,
  getCandidateAnemStats,
  getCandidateAnemNewCount,
} from "../controllers/candidateAnemController.js";

const router = express.Router();

// ============ CANDIDATE ROUTES ============

router.get("/status", auth, authRole(["candidat"]), getCandidateAnemStatus);
router.post("/info-seen", auth, authRole(["candidat"]), markAnemInfoSeen);
router.post("/decline", auth, authRole(["candidat"]), declineCandidateAnem);
router.post(
  "/reset-decline",
  auth,
  authRole(["candidat"]),
  resetCandidateAnemDecline,
);

// Self-declared ID
router.post("/submit-id", auth, authRole(["candidat"]), submitCandidateAnemId);

// Site registration flow
router.post(
  "/start-registration",
  auth,
  authRole(["candidat"]),
  startCandidateRegistration,
);
router.post(
  "/save-step",
  auth,
  authRole(["candidat"]),
  saveCandidateRegistrationStep,
);
router.post(
  "/submit-registration",
  auth,
  authRole(["candidat"]),
  submitCandidateRegistration,
);
router.get(
  "/registration-form",
  auth,
  authRole(["candidat"]),
  getCandidateRegistrationForm,
);

// ============ ADMIN ROUTES ============

const requireCandidateAnemPermission = async (req, res, next) => {
  try {
    const admin = await Admin.findOne({ userId: req.user.id });

    if (!admin) {
      return res.status(403).json({ msg: "Admin introuvable" });
    }

    if (admin.status !== "active") {
      return res.status(403).json({ msg: "Compte admin suspendu" });
    }

    const hasPermission =
      admin.label === "super_admin" ||
      admin.permissions.validateRecruiters ||
      admin.permissions.validateCompanies;

    if (!hasPermission) {
      return res.status(403).json({
        msg: "Permission requise pour gérer les demandes ANEM candidats",
        code: "PERMISSION_DENIED",
      });
    }

    req.admin = admin;
    next();
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// Stats
router.get(
  "/admin/stats",
  auth,
  authRole(["admin"]),
  requireCandidateAnemPermission,
  getCandidateAnemStats,
);

router.get(
  "/admin/demandes/count",
  auth,
  authRole(["admin"]),
  requireCandidateAnemPermission,
  getCandidateAnemNewCount,
);

// Demandes list and detail
router.get(
  "/admin/demandes",
  auth,
  authRole(["admin"]),
  requireCandidateAnemPermission,
  getCandidateAnemDemandes,
);

router.get(
  "/admin/demandes/:demandeId",
  auth,
  authRole(["admin"]),
  requireCandidateAnemPermission,
  getCandidateDemandeDetails,
);

// Pending IDs
router.get(
  "/admin/pending-ids",
  auth,
  authRole(["admin"]),
  requireCandidateAnemPermission,
  getCandidatePendingAnemIds,
);

// Assignment
router.post(
  "/admin/demandes/:demandeId/assign",
  auth,
  authRole(["admin"]),
  requireCandidateAnemPermission,
  assignCandidateDemande,
);

// Status changes
router.post(
  "/admin/demandes/:demandeId/in-progress",
  auth,
  authRole(["admin"]),
  requireCandidateAnemPermission,
  markCandidateDemandeInProgress,
);

// PDF data
router.get(
  "/admin/demandes/:demandeId/pdf-data",
  auth,
  authRole(["admin"]),
  requireCandidateAnemPermission,
  getCandidateAnemPdfData,
);

// Approve / Reject ID
router.post(
  "/admin/demandes/:demandeId/approve-id",
  auth,
  authRole(["admin"]),
  requireCandidateAnemPermission,
  approveCandidateAnemId,
);

router.post(
  "/admin/demandes/:demandeId/reject-id",
  auth,
  authRole(["admin"]),
  requireCandidateAnemPermission,
  rejectCandidateAnemId,
);

// Register / Fail
router.post(
  "/admin/demandes/:demandeId/register",
  auth,
  authRole(["admin"]),
  requireCandidateAnemPermission,
  markCandidateRegistered,
);

router.post(
  "/admin/demandes/:demandeId/fail",
  auth,
  authRole(["admin"]),
  requireCandidateAnemPermission,
  markCandidateAnemFailed,
);

// Notes
router.post(
  "/admin/demandes/:demandeId/note",
  auth,
  authRole(["admin"]),
  requireCandidateAnemPermission,
  addCandidateAnemAdminNote,
);

export default router;
