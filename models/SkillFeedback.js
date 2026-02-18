// models/SkillFeedback.js
import mongoose from "mongoose";

const skillFeedbackSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    candidateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Candidate",
      required: true,
    },
    candidateSkillId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    rawSkillText: {
      type: String,
      required: true,
      trim: true,
    },
    mappedToSkillId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Skill",
    },
    mappedToName: {
      type: String,
      trim: true,
    },
    category: {
      type: String,
      enum: [
        "incorrect_mapping",
        "wrong_domain",
        "skill_merged_incorrectly",
        "other",
      ],
      required: true,
    },
    comment: {
      type: String,
      maxLength: 500,
    },
    status: {
      type: String,
      enum: ["pending", "reviewed", "accepted", "rejected"],
      default: "pending",
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    reviewedAt: { type: Date },
    reviewNote: { type: String },
    actionTaken: {
      type: String,
      enum: [
        "mapping_adjusted",
        "mapping_removed",
        "no_change",
        "user_flagged",
      ],
    },
  },
  { timestamps: true },
);

skillFeedbackSchema.index({ userId: 1, createdAt: -1 });
skillFeedbackSchema.index({ candidateSkillId: 1, status: 1 });
skillFeedbackSchema.index({ status: 1, createdAt: -1 });
skillFeedbackSchema.index({ mappedToSkillId: 1 });

export default mongoose.model("SkillFeedback", skillFeedbackSchema);
