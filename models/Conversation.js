// models/Conversation.js
import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  senderType: {
    type: String,
    enum: ["candidate", "recruiter"],
    required: true,
  },
  content: { type: String, required: true, maxLength: 5000 },
  attachments: [String],
  readAt: Date,
  createdAt: { type: Date, default: Date.now },
});

const conversationSchema = new mongoose.Schema(
  {
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      required: true,
      unique: true, // Une conversation par candidature
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

    // Le candidat a-t-il répondu au moins une fois ?
    candidateHasReplied: { type: Boolean, default: false },

    // Premier message envoyé par le recruteur
    initiatedAt: { type: Date, default: Date.now },

    // Premier réponse du candidat
    firstCandidateReplyAt: Date,

    // Le recruteur ouvre la conversation
    openedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    openedAt: { type: Date, default: Date.now },

    messages: [messageSchema],

    // Compteurs non-lus
    unreadByCandidate: { type: Number, default: 0 },
    unreadByRecruiter: { type: Number, default: 0 },

    lastMessageAt: Date,

    // Statut conversation
    status: {
      type: String,
      enum: ["active", "archived", "closed"],
      default: "active",
    },
    // Contexte de création
    createdWith: {
      type: String,
      enum: ["custom_message", "standard_message"],
      default: "custom_message",
    },
  },
  { timestamps: true },
);

// Index
conversationSchema.index({ recruiterId: 1, candidateHasReplied: 1 });
conversationSchema.index({ candidateId: 1, lastMessageAt: -1 });
conversationSchema.index({ recruiterId: 1, lastMessageAt: -1 });
conversationSchema.index({ applicationId: 1 });

export default mongoose.model("Conversation", conversationSchema);
