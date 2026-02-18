// models/SkillCluster.js
import mongoose from "mongoose";

const skillClusterSchema = new mongoose.Schema(
  {
    canonicalName: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    variants: [
      {
        text: { type: String, required: true, trim: true, lowercase: true },
        usageCount: { type: Number, default: 1 },
        firstSeenAt: { type: Date, default: Date.now },
        lastSeenAt: { type: Date, default: Date.now },
      },
    ],
    suggestedDomain: { type: String, trim: true },
    suggestedSubDomain: { type: String, trim: true },
    suggestedCanonicalName: { type: String, trim: true },
    confidenceScore: { type: Number, default: 0, min: 0, max: 1 },
    totalUsageCount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["pending", "promoted", "dismissed", "flagged"],
      default: "pending",
    },
    promotedToSkillId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Skill",
    },
    promotedAt: { type: Date },
    promotedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    dismissedAt: { type: Date },
    dismissedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    dismissReason: { type: String },
    flagCount: { type: Number, default: 0 },
    isFlagged: { type: Boolean, default: false },
    flagReasons: [
      {
        reason: String,
        flaggedBy: { type: String, enum: ["system", "user", "admin"] },
        flaggedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

skillClusterSchema.index({ status: 1, totalUsageCount: -1 });
skillClusterSchema.index({ canonicalName: 1 });
skillClusterSchema.index({ "variants.text": 1 });
skillClusterSchema.index({ isFlagged: 1, flagCount: -1 });
skillClusterSchema.index({ createdAt: -1 });
skillClusterSchema.index({ totalUsageCount: -1 });

skillClusterSchema.statics.trackVariant = async function (rawText) {
  const normalized = rawText.trim().toLowerCase();

  let cluster = await this.findOne({ "variants.text": normalized });

  if (cluster) {
    const variant = cluster.variants.find((v) => v.text === normalized);
    if (variant) {
      variant.usageCount += 1;
      variant.lastSeenAt = new Date();
    }
    cluster.totalUsageCount += 1;
    await cluster.save();
    return { cluster, isNew: false };
  }

  cluster = await this.findOne({ canonicalName: normalized });

  if (cluster) {
    cluster.variants.push({
      text: normalized,
      usageCount: 1,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    });
    cluster.totalUsageCount += 1;
    await cluster.save();
    return { cluster, isNew: false };
  }

  cluster = await this.create({
    canonicalName: normalized,
    variants: [
      {
        text: normalized,
        usageCount: 1,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
    ],
    totalUsageCount: 1,
  });

  return { cluster, isNew: true };
};

const SkillCluster = mongoose.model("SkillCluster", skillClusterSchema);

export default SkillCluster;
