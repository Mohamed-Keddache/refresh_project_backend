import express from "express";
import auth from "../middleware/auth.js";
import { authRole } from "../middleware/roles.js";
import Admin from "../models/Admin.js";

// ── Recruiter ANEM Registration (kept from V1) ──
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

// ── Admin ANEM Registration Management (kept from V1) ──
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

// ── V2: ANEM Offer Pipeline ──
import {
  // Recruiter
  checkAnemEligibility,
  getRecruiterAnemOffers,
  getOfferAnemStatus,
  recruiterPublishDirect,
  recruiterSubmitClassic,
  recruiterDeleteAnemOffer,
  // Admin
  getAdminAnemOffers,
  getAnemOfferPdfData,
  bulkGetAnemOfferPdfData,
  markAsDepositing,
  markDownloadedAsDepositing,
  markDepositSuccess,
  markDepositFailed,
  addAnemOfferNote,
  getAnemOfferDetails,
  getDeletedAnemOffers,
  hardDeleteAnemOffers,
  getAnemOfferStats,
  toggleAutoCleanup,
} from "../controllers/anemOfferController.js";

const router = express.Router();

// ════════════════════════════════════════════════════════════════
//  RECRUITER: ANEM REGISTRATION (unchanged from V1)
// ════════════════════════════════════════════════════════════════

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

router.post("/submit-id", auth, authRole(["recruteur"]), submitAnemId);

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

// ════════════════════════════════════════════════════════════════
//  RECRUITER: ANEM OFFER V2 PIPELINE
// ════════════════════════════════════════════════════════════════

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

// V2: Recruiter actions on failed ANEM offers
router.post(
  "/offers/:offerId/publish-direct",
  auth,
  authRole(["recruteur"]),
  recruiterPublishDirect,
);
router.post(
  "/offers/:offerId/submit-classic",
  auth,
  authRole(["recruteur"]),
  recruiterSubmitClassic,
);
router.post(
  "/offers/:offerId/delete",
  auth,
  authRole(["recruteur"]),
  recruiterDeleteAnemOffer,
);

// ════════════════════════════════════════════════════════════════
//  ADMIN: ANEM REGISTRATION MANAGEMENT (unchanged from V1)
// ════════════════════════════════════════════════════════════════

const requireAnemPermission = async (req, res, next) => {
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

// Registration stats
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

router.get(
  "/admin/pending-ids",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  getPendingAnemIds,
);

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

router.post(
  "/admin/demandes/:demandeId/in-progress",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  markInProgress,
);

router.get(
  "/admin/demandes/:demandeId/pdf-data",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  getPdfData,
);

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

router.post(
  "/admin/demandes/:demandeId/note",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  addAdminNote,
);

router.post(
  "/admin/demandes/bulk-update",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  bulkUpdateStatus,
);

// ════════════════════════════════════════════════════════════════
//  ADMIN: ANEM OFFER V2 PIPELINE MANAGEMENT
// ════════════════════════════════════════════════════════════════

// Dashboard & Stats
router.get(
  "/admin/offers/stats",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  getAnemOfferStats,
);

// List & Filter (with advanced filters)
router.get(
  "/admin/offers",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  getAdminAnemOffers,
);

// Deleted offers view (soft-deleted by recruiter)
router.get(
  "/admin/offers/deleted",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  getDeletedAnemOffers,
);

// Single offer details
router.get(
  "/admin/offers/:anemOfferId/details",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  getAnemOfferDetails,
);

// PDF operations
router.get(
  "/admin/offers/:anemOfferId/pdf-data",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  getAnemOfferPdfData,
);

router.post(
  "/admin/offers/bulk-pdf-data",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  bulkGetAnemOfferPdfData,
);

// Mark as depositing (bulk)
router.post(
  "/admin/offers/mark-depositing",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  markAsDepositing,
);

// Shortcut: mark all PDF-downloaded offers as depositing
router.post(
  "/admin/offers/mark-downloaded-depositing",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  markDownloadedAsDepositing,
);

// Deposit result: success (starts cooldown)
router.post(
  "/admin/offers/:anemOfferId/deposit-success",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  markDepositSuccess,
);

// Deposit result: failure (with option B1/B2)
router.post(
  "/admin/offers/:anemOfferId/deposit-failed",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  markDepositFailed,
);

// Admin notes
router.post(
  "/admin/offers/:anemOfferId/note",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  addAnemOfferNote,
);

// Hard delete (permanent removal)
router.post(
  "/admin/offers/hard-delete",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  hardDeleteAnemOffers,
);

// Auto-cleanup settings
router.post(
  "/admin/offers/auto-cleanup",
  auth,
  authRole(["admin"]),
  requireAnemPermission,
  toggleAutoCleanup,
);

export default router;
