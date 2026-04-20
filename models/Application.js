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

    source: {
      type: String,
      enum: ["direct", "admin_proposal"],
      default: "direct",
    },
    proposedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    proposedAt: Date,

    // --- Candidate-facing status ---
    candidateStatus: {
      type: String,
      enum: [
        "envoyee",
        "en_cours",
        "entretien",
        "retenue",
        "embauchee",
        "non_retenue",
        "retiree",
        "cancelled",
      ],
      default: "envoyee",
    },

    // --- Recruiter-facing status ---
    recruiterStatus: {
      type: String,
      enum: [
        "nouvelle",
        "consultee",
        "preselection",
        "en_discussion",
        "entretien_planifie",
        "entretien_termine",
        "pending_feedback",
        "shortlisted",
        "retenue",
        "embauche",
        "offer_declined",
        "refusee",
        "retiree_par_candidat",
        "annulee_par_candidat",
      ],
      default: "nouvelle",
    },

    cvUrl: { type: String, required: true },
    coverLetter: { type: String },

    isRepostulation: { type: Boolean, default: false },
    repostulationCount: { type: Number, default: 0 },

    offerSnapshot: {
      titre: String,
      entrepriseNom: String,
      companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
      location: String,
      salaryMin: Number,
      salaryMax: Number,
      type: { type: String },
      wilaya: String,
      domaine: String,
    },

    recruiterNotes: {
      type: String,
      maxLength: 2000,
    },

    // FIX #13: Rejection message visible to candidate
    rejectionMessage: {
      type: String,
      maxLength: 2000,
    },

    isStarred: { type: Boolean, default: false },
    seenByRecruiter: { type: Boolean, default: false },
    seenAt: Date,

    datePostulation: { type: Date, default: Date.now },
    dateDecision: Date,
    withdrawnAt: Date,
    withdrawReason: String,

    // Hire flow dates
    hireOfferedAt: Date,
    hireAcceptedAt: Date,
    hireDeclinedAt: Date,
    hireDeclineReason: String,
    hireCancelledAt: Date,
    hireCancelReason: String,

    statusHistory: [
      {
        candidateStatus: String,
        recruiterStatus: String,
        changedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        changedAt: { type: Date, default: Date.now },
        note: String,
      },
    ],
  },
  { timestamps: true },
);

applicationSchema.index({ offerId: 1, candidateId: 1 }, { unique: true });
applicationSchema.index({ offerId: 1, recruiterStatus: 1 });
applicationSchema.index({ candidateId: 1, candidateStatus: 1 });
applicationSchema.index({ offerId: 1, datePostulation: -1 });
applicationSchema.index({ recruiterStatus: 1, isStarred: 1 });
// FIX #11: Missing indexes
applicationSchema.index({ candidateId: 1, datePostulation: -1 });
applicationSchema.index({ offerId: 1, seenByRecruiter: 1 });
applicationSchema.index({ offerId: 1, source: 1 });
applicationSchema.index({
  candidateId: 1,
  candidateStatus: 1,
  datePostulation: -1,
});
export default mongoose.model("Application", applicationSchema);
