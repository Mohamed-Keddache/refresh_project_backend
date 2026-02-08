// models/Application.js
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

    // === ORIGINE ===
    source: {
      type: String,
      enum: ["direct", "admin_proposal"],
      default: "direct",
    },
    proposedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // Admin qui a proposé
    },
    proposedAt: Date,

    // === STATUTS ===
    candidateStatus: {
      type: String,
      enum: [
        "envoyee",
        "en_cours",
        "retenue",
        "non_retenue", // le candidat est refusé poliment
        "retiree", // le candidat est accepter par le recruteur
        "cancelled",
      ],
      default: "envoyee",
    },

    recruiterStatus: {
      type: String,
      enum: [
        "nouvelle",
        "consultee",
        "preselection",
        "en_discussion",
        "entretien_planifie",
        "entretien_termine",
        "retenue", //le recruteur a choisi le candidat (le recruteur a une liste dedié au candidat accepter)
        "refusee", //le recruteur a refusé le candidat
        "retiree_par_candidat",
        "annulee_par_candidat",
      ],
      default: "nouvelle",
    },

    // === CV ET LETTRE ===
    cvUrl: { type: String, required: true },
    coverLetter: { type: String },

    isRepostulation: { type: Boolean, default: false },

    // === SNAPSHOT OFFRE ===
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

    // === NOTES INTERNES RECRUTEUR ===
    recruiterNotes: {
      type: String,
      maxLength: 2000,
    },

    // === MARQUEURS ===
    isStarred: { type: Boolean, default: false }, // Favori recruteur
    seenByRecruiter: { type: Boolean, default: false },
    seenAt: Date,

    // === DATES CLÉS ===
    datePostulation: { type: Date, default: Date.now },
    dateDecision: Date, // Date de la décision finale
    withdrawnAt: Date, // Date de retrait par candidat
    withdrawReason: String,

    // === HISTORIQUE ===
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

// Index composé unique
applicationSchema.index({ offerId: 1, candidateId: 1 }, { unique: true });

// Index pour les requêtes fréquentes
applicationSchema.index({ offerId: 1, recruiterStatus: 1 });
applicationSchema.index({ candidateId: 1, candidateStatus: 1 });
applicationSchema.index({ offerId: 1, datePostulation: -1 });
applicationSchema.index({ recruiterStatus: 1, isStarred: 1 });

export default mongoose.model("Application", applicationSchema);
