// === routes/anemRoutes.js ===
import express from "express";
import auth from "../middleware/auth.js";
import { authRole } from "../middleware/roles.js";
import Admin from "../models/Admin.js";

// Recruiter controllers
import {
  getAnemStatus,
  checkAnemModalRequired,
  markAnemModalSeen,
  declineAnem,
  resetAnemDecline,
  submitAnemId,
  startRegistration,
  saveRegistrationStep,
  submitRegistration,
  getRegistrationForm,
} from "../controllers/anemController.js";

// Admin controllers
import {
  getAnemDemandes,
  getDemandeDetails,
  getPendingAnemIds,
  assignDemande,
  markInProgress,
  getPdfData,
  approveAnemId,
  rejectAnemId,
  markRegistered,
  markFailed,
  addAdminNote,
  bulkUpdateStatus,
  getAnemStats,
  getNewDemandesCount,
  getAdminsForAssignment,
} from "../controllers/anemController.js";

// ANEM Offer controllers
import {
  checkAnemEligibility,
  enableAnemForOffer,
  disableAnemForOffer,
  getOfferAnemStatus,
  getRecruiterAnemOffers,
} from "../controllers/anemOfferController.js";

const router = express.Router();

// ============================================
// RECRUITER ROUTES
// ============================================

// Status and sidebar
router.get("/status", auth, authRole(["recruteur"]), getAnemStatus);
router.get(
  "/check-modal",
  auth,
  authRole(["recruteur"]),
  checkAnemModalRequired,
);
router.post("/modal-seen", auth, authRole(["recruteur"]), markAnemModalSeen);
router.post("/decline", auth, authRole(["recruteur"]), declineAnem);
router.post("/reset-decline", auth, authRole(["recruteur"]), resetAnemDecline);

// Self-declared ID submission
router.post("/submit-id", auth, authRole(["recruteur"]), submitAnemId);

// Site registration form
router.post(
  "/start-registration",
  auth,
  authRole(["recruteur"]),
  startRegistration,
);
router.post("/save-step", auth, authRole(["recruteur"]), saveRegistrationStep);
router.post(
  "/submit-registration",
  auth,
  authRole(["recruteur"]),
  submitRegistration,
);
router.get(
  "/registration-form",
  auth,
  authRole(["recruteur"]),
  getRegistrationForm,
);

// Offer ANEM management
router.get(
  "/offer-eligibility",
  auth,
  authRole(["recruteur"]),
  checkAnemEligibility,
);
router.get("/offers", auth, authRole(["recruteur"]), getRecruiterAnemOffers);
router.get(
  "/offers/:offerId/status",
  auth,
  authRole(["recruteur"]),
  getOfferAnemStatus,
);
router.post(
  "/offers/:offerId/enable",
  auth,
  authRole(["recruteur"]),
  enableAnemForOffer,
);
router.post(
  "/offers/:offerId/disable",
  auth,
  authRole(["recruteur"]),
  disableAnemForOffer,
);

// ============================================
// ADMIN ROUTES better to create a middleware import { requireAnemPermission } from "../middleware/anemPermissions.js"; but lets keep things like this.
// ============================================

const requireAnemPermission = async (req, res, next) => {
  try {
    const admin = await Admin.findOne({ userId: req.user.id });

    if (!admin) {
      return res.status(403).json({ msg: "Admin introuvable" });
    }

    if (admin.status !== "active") {
      return res.status(403).json({ msg: "Compte admin suspendu" });
    }

    // Check for relevant permissions
    const hasPermission =
      admin.label === "super_admin" ||
      admin.permissions.validateRecruiters ||
      admin.permissions.validateCompanies;

    if (!hasPermission) {
      return res.status(403).json({
        msg: "Permission requise pour gérer les demandes ANEM",
        code: "PERMISSION_DENIED",
      });
    }

    req.admin = admin;
    next();
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// Dashboard and stats
router.get(
  "/admin/stats",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  getAnemStats,
);

router.get(
  "/admin/demandes/count",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  getNewDemandesCount,
);

// Demande listing and details
router.get(
  "/admin/demandes",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  getAnemDemandes,
);

router.get(
  "/admin/demandes/:demandeId",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  getDemandeDetails,
);

// Pending IDs list (separate view)
router.get(
  "/admin/pending-ids",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  getPendingAnemIds,
);

// Assignment
router.get(
  "/admin/admins-for-assignment",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  getAdminsForAssignment,
);

router.post(
  "/admin/demandes/:demandeId/assign",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  assignDemande,
);

// Status management
router.post(
  "/admin/demandes/:demandeId/in-progress",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  markInProgress,
);

// PDF
router.get(
  "/admin/demandes/:demandeId/pdf-data",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  getPdfData,
);

// Approval/Rejection of self-declared IDs
router.post(
  "/admin/demandes/:demandeId/approve-id",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  approveAnemId,
);

router.post(
  "/admin/demandes/:demandeId/reject-id",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  rejectAnemId,
);

// Site registration completion
router.post(
  "/admin/demandes/:demandeId/register",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  markRegistered,
);

router.post(
  "/admin/demandes/:demandeId/fail",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  markFailed,
);

// Notes
router.post(
  "/admin/demandes/:demandeId/note",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  addAdminNote,
);

// Bulk operations
router.post(
  "/admin/demandes/bulk-update",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  bulkUpdateStatus,
);

export default router;
