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
    // Track if this was originally a proposed skill
    wasProposed: {
      type: Boolean,
      default: false,
    },
    proposedSkillId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProposedSkill",
    },
  },
  { timestamps: true },
);

skillSchema.index({ name: "text", category: "text" });

export default mongoose.model("Skill", skillSchema);
