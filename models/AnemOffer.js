// === models/AnemOffer.js ===
import mongoose from "mongoose";

const anemOfferSchema = new mongoose.Schema(
  {
    offerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Offer",
      required: true,
      unique: true,
    },
    recruiterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Recruiter",
      required: true,
    },
    anemRegistrationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AnemRegistration",
      required: true,
    },

    // ANEM-specific offer data
    anemEnabled: { type: Boolean, default: true },
    anemId: { type: String, required: true },

    // Timestamps
    enabledAt: { type: Date, default: Date.now },
    disabledAt: { type: Date },

    // Future: ANEM API integration tracking
    submittedToAnem: { type: Boolean, default: false },
    submittedAt: { type: Date },
    anemReference: { type: String },
    anemResponse: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true },
);

anemOfferSchema.index({ offerId: 1 });
anemOfferSchema.index({ recruiterId: 1 });
anemOfferSchema.index({ anemEnabled: 1 });
anemOfferSchema.index({ recruiterId: 1, anemEnabled: 1 });

export default mongoose.model("AnemOffer", anemOfferSchema);
