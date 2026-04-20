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
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
    },

    // Numéro d'entretien pour cette candidature (Entretien #1, #2, etc.)
    interviewNumber: { type: Number, default: 1 },

    // Format
    type: {
      type: String,
      enum: ["phone", "video", "in_person"],
      default: "video",
    },

    // Durée
    duration: {
      type: Number,
      enum: [15, 30, 45, 60],
      default: 30,
    },

    // Infos de localisation selon le type
    location: String, // Pour in_person
    meetingLink: String, // Pour video
    phoneNumber: String, // Pour phone

    // Mode de planification
    schedulingMode: {
      type: String,
      enum: ["fixed_date", "propose_slots"],
      default: "fixed_date",
    },

    // Date fixe
    scheduledAt: { type: Date },

    // Créneaux proposés (max 3)
    proposedSlots: [
      {
        date: { type: Date, required: true },
        chosen: { type: Boolean, default: false },
      },
    ],

    // Le créneau choisi par le candidat
    chosenSlot: { type: Date },

    // Notes de préparation (visibles par le candidat)
    preparationNotes: String,

    // Statuts de l'entretien
    status: {
      type: String,
      enum: [
        "proposed", // Proposé par le recruteur, en attente du candidat
        "confirmed", // Confirmé par les deux parties
        "rescheduled_by_candidate", // Le candidat propose une autre date
        "rescheduled_by_recruiter", // Le recruteur propose une autre date
        "cancelled_by_candidate", // Annulé par le candidat
        "cancelled_by_recruiter", // Annulé par le recruteur
        "pending_feedback", // L'entretien est passé, en attente du feedback
        "completed", // Feedback donné, entretien terminé
        "no_show_candidate", // Le candidat ne s'est pas présenté
        "no_show_recruiter", // Le recruteur ne s'est pas présenté
      ],
      default: "proposed",
    },

    // Alternative proposée (pour négociation)
    proposedAlternative: {
      date: Date,
      proposedBy: {
        type: String,
        enum: ["candidate", "recruiter"],
      },
      message: String,
      proposedAt: Date,
    },

    // Raison d'annulation (obligatoire)
    cancellationReason: String,
    cancelledBy: {
      type: String,
      enum: ["candidate", "recruiter"],
    },
    cancelledAt: Date,

    // Raison de refus par le candidat
    declineReason: String,

    // Notes privées du recruteur
    recruiterNotes: String,

    // Feedback post-entretien
    feedback: {
      interviewHappened: { type: Boolean },
      noShowReason: {
        type: String,
        enum: ["candidate_absent", "technical_issue", "other"],
      },
      noShowDetails: String,
      rating: { type: Number, min: 1, max: 5 },
      privateNotes: String, // Visible uniquement par l'équipe recrutement
      strengths: [String],
      concerns: [String],
      decision: {
        type: String,
        enum: ["next_round", "shortlist", "reject", "hire"],
      },
      completedAt: Date,
    },

    // Rappels
    reminderSentToCandidate: { type: Boolean, default: false },
    reminderSentToRecruiter: { type: Boolean, default: false },
    reminderSentAt: Date,

    // Référence au message dans la conversation (pour le sticky bar)
    interviewMessageId: { type: mongoose.Schema.Types.ObjectId },
  },
  { timestamps: true },
);

interviewSchema.index({ applicationId: 1 });
interviewSchema.index({ candidateId: 1, status: 1 });
interviewSchema.index({ recruiterId: 1, scheduledAt: 1 });
interviewSchema.index({ status: 1, scheduledAt: 1 });
interviewSchema.index({ scheduledAt: 1 });
interviewSchema.index({ recruiterId: 1, status: 1 });
interviewSchema.index({ conversationId: 1 });

// Méthode pour obtenir la date effective de l'entretien
interviewSchema.methods.getEffectiveDate = function () {
  if (this.chosenSlot) return this.chosenSlot;
  if (this.scheduledAt) return this.scheduledAt;
  return null;
};

// Méthode pour calculer la date de fin de l'entretien
interviewSchema.methods.getEndTime = function () {
  const start = this.getEffectiveDate();
  if (!start) return null;
  return new Date(start.getTime() + this.duration * 60 * 1000);
};

// Méthode pour vérifier si le feedback est dû (1h après fin prévue)
interviewSchema.methods.isFeedbackDue = function () {
  const endTime = this.getEndTime();
  if (!endTime) return false;
  const feedbackDueTime = new Date(endTime.getTime() + 60 * 60 * 1000);
  return new Date() >= feedbackDueTime && this.status === "confirmed";
};

export default mongoose.model("Interview", interviewSchema);
