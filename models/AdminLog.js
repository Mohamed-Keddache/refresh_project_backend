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
        "company_validated",
        "company_rejected",
        "company_suspended",
        "offer_approved",
        "offer_rejected",
        "offer_changes_requested",
        "offer_deleted",
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
        "company_created_by_admin",
        "company_updated_by_admin",
        "company_admin_assigned",
        "company_admin_removed",
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
      ],
    },
    targetId: { type: mongoose.Schema.Types.ObjectId },
    details: { type: mongoose.Schema.Types.Mixed },
    ip: { type: String },
    userAgent: { type: String },
  },
  { timestamps: true }
);

adminLogSchema.index({ createdAt: -1 });
adminLogSchema.index({ action: 1, createdAt: -1 });

const AdminLog = mongoose.model("AdminLog", adminLogSchema);

export const logAdminAction = async (
  adminId,
  action,
  target = {},
  details = {},
  req = null
) => {
  try {
    await AdminLog.create({
      adminId,
      action,
      targetType: target.type,
      targetId: target.id,
      details,
      ip: req?.ip,
      userAgent: req?.get("User-Agent"),
    });
  } catch (err) {
    console.error("Erreur lors du logging admin:", err);
  }
};

export default AdminLog;
