import mongoose from "mongoose";

const adminSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },

    label: {
      type: String,
      enum: [
        "super_admin",
        "support",
        "technical",
        "operational",
        "recruitment",
        "moderation",
        "product",
      ],
      default: "support",
    },

    permissions: {
      createAdmin: { type: Boolean, default: false },
      deleteAdmin: { type: Boolean, default: false },
      editAdminPermissions: { type: Boolean, default: false },
      assignAdminLabels: { type: Boolean, default: false },

      validateOffers: { type: Boolean, default: false },
      validateRecruiters: { type: Boolean, default: false },
      validateCompanies: { type: Boolean, default: false },

      banUsers: { type: Boolean, default: false },
      suspendUsers: { type: Boolean, default: false },

      proposeCandidates: { type: Boolean, default: false },

      manageAnnouncements: { type: Boolean, default: false },
      sendNotifications: { type: Boolean, default: false },

      handleSupportTickets: { type: Boolean, default: false },

      viewStats: { type: Boolean, default: true },
      viewLogs: { type: Boolean, default: false },
    },

    status: {
      type: String,
      enum: ["active", "suspended", "revoked"],
      default: "active",
    },
    suspensionReason: String,
    suspendedUntil: Date,

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

adminSchema.methods.hasPermission = function (permission) {
  if (this.label === "super_admin") return true;
  return this.permissions[permission] === true;
};

export default mongoose.model("Admin", adminSchema);
