// models/Skills.js
import mongoose from "mongoose";

const skillSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    category: {
      type: String,
      trim: true,
      index: true,
    },
    subCategory: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      maxLength: 500,
    },
    aliases: [
      {
        type: String,
        trim: true,
        lowercase: true,
      },
    ],
    isPromoted: {
      type: Boolean,
      default: false,
    },
    promotedFrom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SkillCluster",
    },
    wasProposed: {
      type: Boolean,
      default: false,
    },
    proposedSkillId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProposedSkill",
    },
    usageCount: {
      type: Number,
      default: 0,
    },
    isHidden: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

skillSchema.index({ name: "text", aliases: "text", category: "text" });
skillSchema.index({ aliases: 1 });
skillSchema.index({ usageCount: -1 });
skillSchema.index({ isHidden: 1 });

skillSchema.statics.findByNameOrAlias = async function (query) {
  const normalized = query.trim().toLowerCase();
  return this.findOne({
    $or: [{ name: normalized }, { aliases: normalized }],
    isHidden: { $ne: true },
  });
};

skillSchema.statics.searchSimilar = async function (query, limit = 10) {
  const normalized = query.trim().toLowerCase();
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return this.find({
    $or: [
      { name: { $regex: escaped, $options: "i" } },
      { aliases: { $regex: escaped, $options: "i" } },
    ],
    isHidden: { $ne: true },
  })
    .sort({ usageCount: -1 })
    .limit(limit)
    .lean();
};

export default mongoose.model("Skill", skillSchema);
