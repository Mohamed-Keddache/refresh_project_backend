import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    message: { type: String, required: true },
    type: {
      type: String,
      enum: ["info", "alerte", "validation"],
      default: "info",
    },
    lu: { type: Boolean, default: false },
    date: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

notificationSchema.index({ userId: 1, lu: 1 });
notificationSchema.index({ userId: 1, date: -1 });

// ─── NEW: Auto-emit real-time notification after save ───
notificationSchema.post("save", async function (doc) {
  try {
    // Dynamic import to avoid circular dependency issues at startup
    const { emitNotification, emitNotificationCount } =
      await import("../services/socketEvents.js");

    emitNotification(doc.userId.toString(), doc);
    // Also update the unread count badge
    await emitNotificationCount(doc.userId.toString());
  } catch (err) {
    // Non-blocking: if socket isn't ready, notifications still work via REST
    console.error(
      "Socket notification emit failed (non-blocking):",
      err.message,
    );
  }
});

export default mongoose.model("Notification", notificationSchema);
