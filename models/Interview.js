// models/Interview.js
import mongoose from "mongoose";

const interviewSchema = new mongoose.Schema(
  {
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      required: true,
    },
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
    recruiterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Recruiter",
      required: true,
    },

    // === DÉTAILS ===
    type: {
      type: String,
      enum: ["phone", "video", "in_person"],
      default: "video",
    },
    scheduledAt: { type: Date, required: true },
    duration: { type: Number, default: 30 }, // minutes
    location: String, // Pour in_person
    meetingLink: String, // Pour video
    phoneNumber: String, // Pour phone

    // === STATUT ===
    status: {
      type: String,
      enum: [
        "proposed", // Proposé par recruteur, en attente réponse candidat
        "confirmed", // Accepté par candidat
        "rescheduled_by_candidate", // Candidat propose nouvelle date
        "rescheduled_by_recruiter", // Recruteur propose nouvelle date
        "cancelled_by_candidate",
        "cancelled_by_recruiter",
        "completed", // Entretien passé
        "no_show_candidate", // Candidat absent
        "no_show_recruiter", // Recruteur absent (rare mais possible)
      ],
      default: "proposed",
    },

    // === PROPOSITION ALTERNATIVE ===
    proposedAlternative: {
      date: Date,
      proposedBy: {
        type: String,
        enum: ["candidate", "recruiter"],
      },
      message: String,
      proposedAt: Date,
    },

    // === NOTES ===
    recruiterNotes: String, // Notes privées recruteur
    preparationNotes: String, // Notes partagées avec candidat (optionnel)

    // === FEEDBACK POST-ENTRETIEN ===
    feedback: {
      rating: { type: Number, min: 1, max: 5 },
      notes: String,
      strengths: [String],
      concerns: [String],
      recommendation: {
        type: String,
        enum: ["strong_yes", "yes", "maybe", "no", "strong_no"],
      },
      completedAt: Date,
    },

    // === RAPPELS ===
    reminderSentToCandidate: { type: Boolean, default: false },
    reminderSentToRecruiter: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Index
interviewSchema.index({ applicationId: 1 });
interviewSchema.index({ candidateId: 1, status: 1 });
interviewSchema.index({ recruiterId: 1, scheduledAt: 1 });
interviewSchema.index({ status: 1, scheduledAt: 1 });
interviewSchema.index({ scheduledAt: 1 }); // Pour les rappels

export default mongoose.model("Interview", interviewSchema);
