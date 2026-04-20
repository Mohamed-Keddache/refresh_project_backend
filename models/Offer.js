import mongoose from "mongoose";

const offerSchema = new mongoose.Schema(
  {
    recruteurId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Recruiter",
      required: true,
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },

    titre: { type: String, required: true },
    description: { type: String, required: true },
    requirements: { type: String, required: true },

    domaine: { type: String },
    type: {
      type: String,
      enum: [
        "full-time",
        "part-time",
        "remote",
        "internship",
        "freelance",
        "CDI",
        "CDD",
      ],
      default: "full-time",
    },
    salaryMin: { type: Number },
    salaryMax: { type: Number },
    experienceLevel: { type: String, enum: ["junior", "mid", "senior"] },
    skills: [{ type: String, index: true }],
    wilaya: { type: String },

    // ── Repostulation Settings ──
    allowRepostulation: { type: Boolean, default: true },
    repostulationCooldownDays: { type: Number, default: 30 },
    maxRepostulations: { type: Number, default: 2 },
    hiresNeeded: { type: Number },

    // ── Validation Status (V2: added "pending_anem") ──
    validationStatus: {
      type: String,
      enum: [
        "draft",
        "pending", // Classic validation by admin
        "pending_anem", // V2: In ANEM pipeline
        "approved",
        "rejected",
        "changes_requested",
      ],
      default: "pending",
    },
    validationHistory: [
      {
        status: String,
        message: String,
        adminId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        date: { type: Date, default: Date.now },
      },
    ],
    rejectionReason: String,

    visibility: {
      isPublic: { type: Boolean, default: true },
      acceptsDirectApplications: { type: Boolean, default: true },
    },

    candidateSearchMode: {
      type: String,
      enum: ["disabled", "manual", "automatic"],
      default: "disabled",
    },

    actif: { type: Boolean, default: false },
    datePublication: { type: Date },
    nombreCandidatures: { type: Number, default: 0 },

    // ── V2: ANEM Flag ──
    isAnem: { type: Boolean, default: false },

    // ── V2: Soft Delete ──
    isDeletedByRecruiter: { type: Boolean, default: false },
    deletedByRecruiterAt: { type: Date },
  },
  { timestamps: true },
);

offerSchema.methods.isVisible = function () {
  return (
    this.validationStatus === "approved" &&
    this.actif &&
    !this.isDeletedByRecruiter
  );
};

offerSchema.index({ titre: "text", description: "text", skills: "text" });

offerSchema.index({ recruteurId: 1, actif: 1, validationStatus: 1 });
offerSchema.index({ companyId: 1 });
offerSchema.index({ validationStatus: 1, datePublication: -1 });
offerSchema.index({ candidateSearchMode: 1, actif: 1, validationStatus: 1 });
offerSchema.index({ isAnem: 1, validationStatus: 1 });
offerSchema.index({ isDeletedByRecruiter: 1 });

export default mongoose.model("Offer", offerSchema);
