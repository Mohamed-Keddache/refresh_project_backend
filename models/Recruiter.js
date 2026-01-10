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
  { timestamps: true }
);

recruiterSchema.index({ userId: 1 });
recruiterSchema.index({ companyId: 1 });
recruiterSchema.index({ status: 1 });

recruiterSchema.methods.canPerformActions = function () {
  return this.status === "validated";
};

recruiterSchema.methods.hasPendingRequests = function () {
  return this.validationRequests.some((r) => r.status === "pending");
};

export default mongoose.model("Recruiter", recruiterSchema);
