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
  { timestamps: true }
);

notificationSchema.index({ userId: 1, lu: 1 });
notificationSchema.index({ userId: 1, date: -1 });

export default mongoose.model("Notification", notificationSchema);
