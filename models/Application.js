import mongoose from "mongoose";

const applicationSchema = new mongoose.Schema(
  {
    offerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Offer",
      required: true,
    },

    candidateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Candidate",
      required: true,
    },

    offerSnapshot: {
      titre: { type: String },
      entrepriseNom: { type: String },
      companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
      location: { type: String },
      salaryMin: { type: Number },
      salaryMax: { type: Number },
      type: { type: String },
    },

    cvUrl: { type: String, required: true },
    coverLetter: { type: String },

    status: {
      type: String,
      enum: [
        "en attente",
        "vu",
        "présélectionné",
        "entretien",

        "accepté",
        "embauché",
        "rejeté",
        "proposé",
        "retiré",
      ],
      default: "en attente",
    },

    interviewDetails: {
      scheduledAt: Date,
      location: String,
      meetingLink: String,
      notes: String,
      confirmedByCandidate: Boolean,
    },

    recommandeParAdmin: { type: Boolean, default: false },

    datePostulation: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

applicationSchema.index({ offerId: 1, candidateId: 1 }, { unique: true });
applicationSchema.index({ offerId: 1, datePostulation: -1 });
applicationSchema.index({ candidateId: 1, datePostulation: -1 });

export default mongoose.model("Application", applicationSchema);
