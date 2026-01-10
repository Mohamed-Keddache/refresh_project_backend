import mongoose from "mongoose";

const announcementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    content: { type: String, required: true },
    targetAudience: {
      type: String,
      enum: ["all", "admins", "recruiters", "candidates"],
      default: "all",
    },
    status: {
      type: String,
      enum: ["draft", "scheduled", "published", "expired", "archived"],
      default: "draft",
    },
    publishAt: { type: Date },
    expiresAt: { type: Date },
    priority: {
      type: String,
      enum: ["low", "normal", "high", "critical"],
      default: "normal",
    },
    displayType: {
      type: String,
      enum: ["banner", "modal", "inline"],
      default: "inline",
    },
    viewCount: { type: Number, default: 0 },
    dismissedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

announcementSchema.index({ status: 1, publishAt: 1, expiresAt: 1 });

export default mongoose.model("Announcement", announcementSchema);
