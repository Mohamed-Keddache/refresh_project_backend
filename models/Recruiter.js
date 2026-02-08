// === models/Recruiter.js ===
import mongoose from "mongoose";

const recruiterSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },

    telephone: { type: String },
    position: { type: String },

    status: {
      type: String,
      enum: [
        "pending_validation",
        "pending_documents",
        "pending_info",
        "pending_info_and_documents",
        "pending_revalidation",
        "validated",
        "rejected",
      ],
      default: "pending_validation",
    },

    rejectionReason: String,

    validationRequests: [
      {
        type: {
          type: String,
          enum: ["document", "information", "clarification"],
        },
        message: String,
        requiredFields: [String],
        requiredDocuments: Number,
        response: {
          text: String,
          documents: [String],
          submittedAt: Date,
        },
        status: {
          type: String,
          enum: ["pending", "submitted", "approved", "rejected"],
          default: "pending",
        },
        createdAt: { type: Date, default: Date.now },
        reviewedAt: Date,
        reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      },
    ],

    permissions: {
      postJobs: { type: Boolean, default: true },
      reviewCandidates: { type: Boolean, default: true },
      scheduleInterviews: { type: Boolean, default: true },
      manageTeam: { type: Boolean, default: false },
      editCompany: { type: Boolean, default: false },
    },

    isAdmin: { type: Boolean, default: false },

    // ==========================================
    // ANEM Registration Status
    // ==========================================
    anem: {
      // Reference to the AnemRegistration document
      registrationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "AnemRegistration",
      },

      // Current status synced from AnemRegistration
      status: {
        type: String,
        enum: [
          "not_started",
          "draft",
          "pending",
          "pending_verification",
          "in_progress",
          "registered",
          "failed",
          "rejected",
        ],
        default: "not_started",
      },

      // Verified ANEM ID (copied here for quick access)
      anemId: { type: String },

      // When successfully registered
      registeredAt: { type: Date },

      // Track if user has seen the initial ANEM modal (first offer creation)
      hasSeenAnemModal: { type: Boolean, default: false },
      modalSeenAt: { type: Date },

      // Track if user explicitly declined ANEM (said "No" to first question)
      declinedAnem: { type: Boolean, default: false },
      declinedAt: { type: Date },

      // Last status update timestamp
      lastStatusUpdate: { type: Date },
    },

    favoriteCandidates: [
      {
        candidateId: { type: mongoose.Schema.Types.ObjectId, ref: "Candidate" },
        savedAt: { type: Date, default: Date.now },
        notes: String,
      },
    ],

    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Recruiter" },
    invitedAt: Date,
  },
  { timestamps: true },
);

recruiterSchema.index({ userId: 1 });
recruiterSchema.index({ companyId: 1 });
recruiterSchema.index({ status: 1 });
recruiterSchema.index({ "anem.status": 1 });
recruiterSchema.index({ "anem.anemId": 1 });

recruiterSchema.methods.canPerformActions = function () {
  return this.status === "validated";
};

recruiterSchema.methods.hasPendingRequests = function () {
  return this.validationRequests.some((r) => r.status === "pending");
};

recruiterSchema.methods.isAnemRegistered = function () {
  return this.anem.status === "registered" && this.anem.anemId;
};

recruiterSchema.methods.canCreateAnemOffer = function () {
  return this.anem.status === "registered" && this.anem.anemId;
};

recruiterSchema.methods.shouldShowAnemModal = function (offerCount) {
  // Show modal if:
  // 1. First offer creation AND hasn't seen modal yet
  // 2. OR trying to enable ANEM toggle but not registered and hasn't declined
  if (offerCount === 0 && !this.anem.hasSeenAnemModal) {
    return { show: true, reason: "first_offer" };
  }
  return { show: false, reason: null };
};

recruiterSchema.methods.updateAnemStatus = async function (
  newStatus,
  anemId = null,
) {
  this.anem.status = newStatus;
  this.anem.lastStatusUpdate = new Date();

  if (newStatus === "registered" && anemId) {
    this.anem.anemId = anemId;
    this.anem.registeredAt = new Date();
  }

  await this.save();
};

export default mongoose.model("Recruiter", recruiterSchema);
