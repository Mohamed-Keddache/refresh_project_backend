import express from "express";
import auth from "../middleware/auth.js";
import { authRole } from "../middleware/roles.js";
import Admin from "../models/Admin.js";

import {
  getRecruiters,
  validateRecruiter,
  rejectRecruiter,
  requestRecruiterDocuments,
  requestMultipleValidationItems,
  cancelValidationRequest,
  getAllUsers,
  banUser,
  unBanUser,
  sendMessageToUser,
  getCandidateDetailsAdmin,
  createAdmin,
  deleteAdmin,
  getAllAdmins,
  suspendAdmin,
  updateAdminPermissions,
  updateAdminLabel,
  getPendingCompanies,
  validateCompany,
  rejectCompany,
  getCompanyDetailsAdmin,
  getAllCompanies,
  getPendingOffers,
  approveOffer,
  rejectOffer,
  deleteOfferAdmin,
  getManualSelectionOffers,
  proposeCandidateToOffer,
  toggleOfferVisibility,
  getGlobalStats,
  getTrends,
  getAdminLogs,
  createCompanyByAdmin,
  getCompanyRecruiters,
  assignCompanyAdmin,
  removeCompanyAdmin,
  updateCompanyByAdmin,
  getOfferDetailsAdmin,
  updateOfferByAdmin,
} from "../controllers/adminController.js";

import {
  getSkills,
  createSkill,
  updateSkill,
  deleteSkill,
  getTrendingClusters,
  getDuplicateClusters,
  getOrphanClusters,
  getFlaggedClusters,
  getClusterDetail,
  promoteCluster,
  dismissCluster,
  flagCluster,
  unflagCluster,
  getSkillFeedback,
  reviewSkillFeedback,
  getSkillSystemStats,
  getSkillSettings,
  updateSkillSettings,
} from "../controllers/skillController.js";

import {
  createAnnouncement,
  getAllAnnouncements,
  updateAnnouncement,
  deleteAnnouncement,
} from "../controllers/announcementController.js";

import {
  getTicketsByLabel,
  getTicketById,
  respondToTicket,
  reassignTicket,
  closeTicket,
} from "../controllers/adminSupportController.js";

import {
  toggleEmailVerificationMode,
  getEmailVerificationMode,
  toggleSkillProposal,
  getAllSettings,
  getSettingsByCategory,
  updateSettingsBulk,
} from "../controllers/adminSettingsController.js";

import { uploadAttachments } from "../config/multer.js";

const router = express.Router();

router.use(auth, authRole(["admin"]));

const requirePermission = (permission) => async (req, res, next) => {
  try {
    const admin = await Admin.findOne({ userId: req.user.id });

    if (!admin) return res.status(403).json({ msg: "Admin introuvable" });
    if (admin.status !== "active")
      return res.status(403).json({ msg: "Compte admin suspendu" });

    if (!admin.hasPermission(permission)) {
      return res.status(403).json({
        msg: `Permission "${permission}" requise`,
        code: "PERMISSION_DENIED",
      });
    }

    req.admin = admin;
    next();
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

////////////////////////////////////////////////////
// STATS
////////////////////////////////////////////////////
router.get("/stats/global", requirePermission("viewStats"), getGlobalStats);
router.get("/stats/trends", requirePermission("viewStats"), getTrends);

////////////////////////////////////////////////////
// RECRUTEURS
////////////////////////////////////////////////////
router.get(
  "/recruteurs",
  requirePermission("validateRecruiters"),
  getRecruiters,
);
router.put(
  "/recruteurs/valider/:id",
  requirePermission("validateRecruiters"),
  validateRecruiter,
);
router.put(
  "/recruteurs/rejeter/:id",
  requirePermission("validateRecruiters"),
  rejectRecruiter,
);
router.post(
  "/recruteurs/:recruiterId/request-documents",
  requirePermission("validateRecruiters"),
  requestRecruiterDocuments,
);
router.post(
  "/recruteurs/:recruiterId/request-multiple",
  requirePermission("validateRecruiters"),
  requestMultipleValidationItems,
);
router.put(
  "/recruteurs/:id/cancel-request",
  requirePermission("validateRecruiters"),
  cancelValidationRequest,
);

////////////////////////////////////////////////////
// USERS
////////////////////////////////////////////////////
router.get("/users", getAllUsers);
router.put("/users/ban/:id", requirePermission("banUsers"), banUser);
router.put("/users/unban/:id", requirePermission("banUsers"), unBanUser);
router.post(
  "/users/message/:id",
  requirePermission("sendNotifications"),
  sendMessageToUser,
);

////////////////////////////////////////////////////
// ADMINS
////////////////////////////////////////////////////
router.get("/admins", requirePermission("viewStats"), getAllAdmins);
router.post("/admins", requirePermission("createAdmin"), createAdmin);
router.put(
  "/admins/:id/suspend",
  requirePermission("deleteAdmin"),
  suspendAdmin,
);
router.put(
  "/admins/:id/permissions",
  requirePermission("editAdminPermissions"),
  updateAdminPermissions,
);
router.put(
  "/admins/:id/label",
  requirePermission("assignAdminLabels"),
  updateAdminLabel,
);
router.delete("/admins/:id", requirePermission("deleteAdmin"), deleteAdmin);

////////////////////////////////////////////////////
// ENTREPRISES (ORDER FIXED)
////////////////////////////////////////////////////

// Static routes
router.get(
  "/entreprises/all",
  requirePermission("validateCompanies"),
  getAllCompanies,
);
router.get(
  "/entreprises/en-attente",
  requirePermission("validateCompanies"),
  getPendingCompanies,
);
router.post(
  "/entreprises/create",
  requirePermission("validateCompanies"),
  createCompanyByAdmin,
);
router.post(
  "/entreprises/assign-admin",
  requirePermission("validateCompanies"),
  assignCompanyAdmin,
);
router.put(
  "/entreprises/valider/:id",
  requirePermission("validateCompanies"),
  validateCompany,
);
router.put(
  "/entreprises/rejeter/:id",
  requirePermission("validateCompanies"),
  rejectCompany,
);
router.delete(
  "/entreprises/remove-admin/:recruiterId",
  requirePermission("validateCompanies"),
  removeCompanyAdmin,
);

// Nested param routes
router.get(
  "/entreprises/:companyId/recruiters",
  requirePermission("validateCompanies"),
  getCompanyRecruiters,
);

// Generic param routes LAST
router.get(
  "/entreprises/:companyId",
  requirePermission("validateCompanies"),
  getCompanyDetailsAdmin,
);
router.put(
  "/entreprises/:id",
  requirePermission("validateCompanies"),
  updateCompanyByAdmin,
);

////////////////////////////////////////////////////
// OFFRES (ORDER SAFE)
////////////////////////////////////////////////////
router.get(
  "/offres/en-attente",
  requirePermission("validateOffers"),
  getPendingOffers,
);
router.get(
  "/offres/manuelles",
  requirePermission("proposeCandidates"),
  getManualSelectionOffers,
);
router.post(
  "/offres/proposer",
  requirePermission("proposeCandidates"),
  proposeCandidateToOffer,
);

router.put(
  "/offres/:id/approve",
  requirePermission("validateOffers"),
  approveOffer,
);
router.put(
  "/offres/:id/reject",
  requirePermission("validateOffers"),
  rejectOffer,
);
router.put(
  "/offres/:id/update",
  requirePermission("validateOffers"),
  updateOfferByAdmin,
);
router.put(
  "/offres/:id/visibility",
  requirePermission("validateOffers"),
  toggleOfferVisibility,
);
router.get(
  "/offres/:id/details",
  requirePermission("validateOffers"),
  getOfferDetailsAdmin,
);
router.delete(
  "/offres/:id",
  requirePermission("validateOffers"),
  deleteOfferAdmin,
);

////////////////////////////////////////////////////
// CANDIDATES
////////////////////////////////////////////////////
router.get(
  "/candidates/:id",
  requirePermission("viewStats"),
  getCandidateDetailsAdmin,
);

////////////////////////////////////////////////////
// ANNOUNCEMENTS
////////////////////////////////////////////////////
router.get(
  "/announcements",
  requirePermission("manageAnnouncements"),
  getAllAnnouncements,
);
router.post(
  "/announcements",
  requirePermission("manageAnnouncements"),
  createAnnouncement,
);
router.put(
  "/announcements/:id",
  requirePermission("manageAnnouncements"),
  updateAnnouncement,
);
router.delete(
  "/announcements/:id",
  requirePermission("manageAnnouncements"),
  deleteAnnouncement,
);

////////////////////////////////////////////////////
// SUPPORT TICKETS
////////////////////////////////////////////////////
router.get(
  "/tickets",
  requirePermission("handleSupportTickets"),
  getTicketsByLabel,
);
router.get(
  "/tickets/:ticketId",
  requirePermission("handleSupportTickets"),
  getTicketById,
);
router.post(
  "/tickets/:ticketId/respond",
  requirePermission("handleSupportTickets"),
  uploadAttachments.array("attachments", 3),
  respondToTicket,
);
router.put(
  "/tickets/:ticketId/reassign",
  requirePermission("handleSupportTickets"),
  reassignTicket,
);
router.put(
  "/tickets/:ticketId/close",
  requirePermission("handleSupportTickets"),
  closeTicket,
);

////////////////////////////////////////////////////
// LOGS
////////////////////////////////////////////////////
router.get("/logs", requirePermission("viewLogs"), getAdminLogs);

////////////////////////////////////////////////////
// SETTINGS
////////////////////////////////////////////////////
router.get("/settings", getAllSettings);
router.get("/settings/category/:category", getSettingsByCategory);
router.get("/settings/email-verification-mode", getEmailVerificationMode);
router.post("/settings/email-verification-mode", toggleEmailVerificationMode);
router.post("/settings/skill-proposal", toggleSkillProposal);
router.put(
  "/settings/bulk",
  requirePermission("editAdminPermissions"),
  updateSettingsBulk,
);

////////////////////////////////////////////////////
// SKILLS (ALREADY CORRECT)
////////////////////////////////////////////////////
router.get(
  "/skills/stats",
  requirePermission("viewStats"),
  getSkillSystemStats,
);
router.get(
  "/skills/settings",
  requirePermission("viewStats"),
  getSkillSettings,
);
router.put(
  "/skills/settings",
  requirePermission("editAdminPermissions"),
  updateSkillSettings,
);

router.get(
  "/skills/clusters/trending",
  requirePermission("validateOffers"),
  getTrendingClusters,
);
router.get(
  "/skills/clusters/duplicates",
  requirePermission("validateOffers"),
  getDuplicateClusters,
);
router.get(
  "/skills/clusters/orphans",
  requirePermission("validateOffers"),
  getOrphanClusters,
);
router.get(
  "/skills/clusters/flagged",
  requirePermission("validateOffers"),
  getFlaggedClusters,
);
router.get(
  "/skills/clusters/:clusterId",
  requirePermission("validateOffers"),
  getClusterDetail,
);
router.post(
  "/skills/clusters/:clusterId/promote",
  requirePermission("validateOffers"),
  promoteCluster,
);
router.post(
  "/skills/clusters/:clusterId/dismiss",
  requirePermission("validateOffers"),
  dismissCluster,
);
router.post(
  "/skills/clusters/:clusterId/flag",
  requirePermission("validateOffers"),
  flagCluster,
);
router.post(
  "/skills/clusters/:clusterId/unflag",
  requirePermission("validateOffers"),
  unflagCluster,
);

router.get(
  "/skills/feedback",
  requirePermission("validateOffers"),
  getSkillFeedback,
);
router.post(
  "/skills/feedback/:feedbackId/review",
  requirePermission("validateOffers"),
  reviewSkillFeedback,
);

router.get("/skills", requirePermission("viewStats"), getSkills);
router.post("/skills", requirePermission("validateOffers"), createSkill);
router.put("/skills/:id", requirePermission("validateOffers"), updateSkill);
router.delete("/skills/:id", requirePermission("validateOffers"), deleteSkill);

export default router;
