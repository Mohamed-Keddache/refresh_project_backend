import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  senderType: {
    type: String,
    enum: ["candidate", "recruiter", "system"],
    required: true,
  },
  content: { type: String, required: true, maxLength: 5000 },
  attachments: [String],
  readAt: Date,
  createdAt: { type: Date, default: Date.now },

  // Type de message spécial
  messageType: {
    type: String,
    enum: [
      "text", // Message texte normal
      "predefined", // Message pré-défini (premier contact)
      "interview_card", // Carte d'entretien
      "interview_response", // Réponse à un entretien (accepter/refuser/négocier)
      "negotiate", // Message de négociation d'entretien
      "hire_offer", // Proposition d'embauche
      "hire_response", // Réponse embauche (accepter/décliner)
      "hire_cancelled", // Annulation de la proposition d'embauche
      "rejection", // Message de refus
      "system", // Message système
      "closure", // Message de clôture
    ],
    default: "text",
  },

  // Métadonnées pour les messages spéciaux
  metadata: {
    interviewId: { type: mongoose.Schema.Types.ObjectId, ref: "Interview" },
    interviewNumber: Number,
    predefinedTemplateId: String,
    negotiateTag: { type: Boolean, default: false },
  },
});

const conversationSchema = new mongoose.Schema(
  {
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      required: true,
      unique: true,
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

    // Verrouillage du chat (garder de l'ancien flow)
    isClosed: { type: Boolean, default: false },
    closedReason: {
      type: String,
      enum: [
        "recruiter_locked",
        "application_rejected",
        "application_closed",
        "offer_closed",
      ],
    },

    candidateHasReplied: { type: Boolean, default: false },
    initiatedAt: { type: Date, default: Date.now },
    firstCandidateReplyAt: Date,

    openedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    openedAt: { type: Date, default: Date.now },

    messages: [messageSchema],

    unreadByCandidate: { type: Number, default: 0 },
    unreadByRecruiter: { type: Number, default: 0 },

    lastMessageAt: Date,

    status: {
      type: String,
      enum: ["active", "archived", "closed"],
      default: "active",
    },

    // Entretiens actifs liés à cette conversation
    activeInterviewIds: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Interview" },
    ],

    createdWith: {
      type: String,
      enum: ["predefined_message", "custom_message"],
      default: "predefined_message",
    },
  },
  { timestamps: true },
);

conversationSchema.index({ recruiterId: 1, candidateHasReplied: 1 });
conversationSchema.index({ candidateId: 1, lastMessageAt: -1 });
conversationSchema.index({ recruiterId: 1, lastMessageAt: -1 });
conversationSchema.index({ offerId: 1 });
conversationSchema.index({ status: 1 });
export default mongoose.model("Conversation", conversationSchema);
