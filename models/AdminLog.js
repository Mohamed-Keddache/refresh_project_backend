// models/AdminLog.js
import mongoose from "mongoose";

const adminLogSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    action: {
      type: String,
      enum: [
        "admin_created",
        "admin_deleted",
        "admin_suspended",
        "admin_reactivated",
        "admin_permissions_updated",
        "admin_label_changed",
        "recruiter_validated",
        "recruiter_rejected",
        "recruiter_suspended",
        "recruiter_documents_requested",
        "recruiter_revalidated",
        "recruiter_request_canceled",
        "recruiter_multiple_requests",
        "company_validated",
        "company_rejected",
        "company_suspended",
        "company_created_by_admin",
        "company_updated_by_admin",
        "company_admin_assigned",
        "company_admin_removed",
        "offer_approved",
        "offer_rejected",
        "offer_changes_requested",
        "offer_deleted",
        "offer_updated_by_admin",
        "offer_activated_admin",
        "offer_deactivated_admin",
        "user_banned",
        "user_unbanned",
        "user_message_sent",
        "candidate_proposed",
        "announcement_created",
        "announcement_updated",
        "announcement_deleted",
        "ticket_responded",
        "ticket_closed",
        "ticket_reassigned",
        "anem_demande_viewed",
        "anem_demande_assigned",
        "anem_demande_in_progress",
        "anem_pdf_downloaded",
        "anem_id_approved",
        "anem_id_rejected",
        "anem_registration_success",
        "anem_registration_failed",
        "anem_bulk_status_update",
        "anem_note_added",
        // Skill system actions
        "skill_created",
        "skill_updated",
        "skill_deleted",
        "skill_cluster_promoted",
        "skill_cluster_dismissed",
        "skill_feedback_reviewed",
        "skill_settings_updated",
        "candidate_anem_demande_viewed",
        "candidate_anem_demande_assigned",
        "candidate_anem_demande_in_progress",
        "candidate_anem_pdf_downloaded",
        "candidate_anem_id_approved",
        "candidate_anem_id_rejected",
        "candidate_anem_registration_success",
        "candidate_anem_registration_failed",
        "candidate_anem_note_added",
      ],
      required: true,
      index: true,
    },
    targetType: {
      type: String,
      enum: [
        "user",
        "recruiter",
        "company",
        "offer",
        "application",
        "announcement",
        "ticket",
        "admin",
        "anem_registration",
        "candidate_anem_registration",
        "skill",
        "skill_cluster",
        "skill_feedback",
        "system_settings",
      ],
    },
    targetId: { type: mongoose.Schema.Types.ObjectId },
    details: { type: mongoose.Schema.Types.Mixed },
    ip: { type: String },
    userAgent: { type: String },
  },
  { timestamps: true },
);

adminLogSchema.index({ createdAt: -1 });
adminLogSchema.index({ action: 1, createdAt: -1 });
adminLogSchema.index({ targetType: 1, targetId: 1 });

const AdminLog = mongoose.model("AdminLog", adminLogSchema);

export const logAdminAction = async (
  adminId,
  action,
  target = {},
  details = {},
  req = null,
) => {
  try {
    await AdminLog.create({
      adminId,
      action,
      targetType: target.type,
      targetId: target.id,
      details,
      ip: req?.ip || req?.connection?.remoteAddress,
      userAgent: req?.get?.("User-Agent") || req?.headers?.["user-agent"],
    });
  } catch (err) {
    console.error("Erreur lors du logging admin:", err);
  }
};

export default AdminLog;
