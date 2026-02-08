import mongoose from "mongoose";

const proposedSkillSchema = new mongoose.Schema(
  {
    label: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    domain: {
      type: String,
      default: null,
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "merged"],
      default: "pending",
      index: true,
    },
    proposedBy: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        candidateId: { type: mongoose.Schema.Types.ObjectId, ref: "Candidate" },
        proposedAt: { type: Date, default: Date.now },
      },
    ],
    proposalCount: {
      type: Number,
      default: 1,
    },
    // When approved, reference to the official skill
    approvedSkillId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Skill",
    },
    // Admin actions
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    reviewedAt: Date,
    reviewNote: String,
    // For merging duplicates
    mergedInto: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProposedSkill",
    },
  },
  { timestamps: true },
);

// Unique index on normalized label
proposedSkillSchema.index({ label: 1 }, { unique: true });
proposedSkillSchema.index({ status: 1, proposalCount: -1 });

/**
 * Find or create a proposed skill
 */
proposedSkillSchema.statics.proposeSkill = async function (
  label,
  userId,
  candidateId,
) {
  const normalizedLabel = label.trim().toLowerCase();

  // Check if already exists
  let proposedSkill = await this.findOne({ label: normalizedLabel });

  if (proposedSkill) {
    // Add this user to proposers if not already there
    const alreadyProposed = proposedSkill.proposedBy.some(
      (p) => p.userId?.toString() === userId,
    );

    if (!alreadyProposed) {
      proposedSkill.proposedBy.push({
        userId,
        candidateId,
        proposedAt: new Date(),
      });
      proposedSkill.proposalCount += 1;
      await proposedSkill.save();
    }

    return { proposedSkill, isNew: false };
  }

  // Create new proposed skill
  proposedSkill = await this.create({
    label: normalizedLabel,
    proposedBy: [{ userId, candidateId, proposedAt: new Date() }],
  });

  return { proposedSkill, isNew: true };
};

export default mongoose.model("ProposedSkill", proposedSkillSchema);
