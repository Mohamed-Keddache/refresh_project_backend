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

    validationStatus: {
      type: String,
      enum: ["draft", "pending", "approved", "rejected", "changes_requested"],
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
  },
  { timestamps: true }
);

offerSchema.methods.isVisible = function () {
  return this.validationStatus === "approved" && this.actif;
};

offerSchema.index({ titre: "text", description: "text", skills: "text" });

export default mongoose.model("Offer", offerSchema);
