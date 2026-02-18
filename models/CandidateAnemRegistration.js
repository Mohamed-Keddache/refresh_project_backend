// models/CandidateAnemRegistration.js
import mongoose from "mongoose";

const candidateAnemRegistrationSchema = new mongoose.Schema(
  {
    candidateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Candidate",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Type: self-declared ID or full site registration
    registrationType: {
      type: String,
      enum: ["self_declared", "site_registration"],
      required: true,
    },

    // For self-declared
    declaredAnemId: { type: String },
    declaredAt: { type: Date },

    // Step 1: État civil
    step1: {
      civilite: {
        type: String,
        enum: ["monsieur", "madame"],
      },
      nom: { type: String },
      prenom: { type: String },
      estPresume: { type: Boolean, default: false },
      numeroActeNaissance: { type: String },
      dateNaissance: { type: Date },
      paysNaissance: { type: String, default: "Algérie" },
      wilayaNaissance: { type: String },
      communeNaissance: { type: String },
      situationFamiliale: {
        type: String,
        enum: ["celibataire", "marie", "divorce", "veuf"],
      },
      situationServiceNational: {
        type: String,
        enum: ["accompli", "exempte", "sursis", "non_concerne"],
      },
      nombreEnfantsCharge: { type: Number, default: 0 },
    },

    // Step 2: Contact
    step2: {
      mobile: { type: String },
      fax: { type: String },
      wilayaResidence: { type: String },
      communeResidence: { type: String },
      quartierResidence: { type: String },
      adresse: { type: String },
      // Arabic info
      nomArabe: { type: String },
      prenomArabe: { type: String },
      adresseArabe: { type: String },
    },

    // Step 3: Autres informations
    step3: {
      typePieceIdentite: {
        type: String,
        enum: [
          "carte_identite",
          "passeport",
          "permis_conduire",
          "carte_sejour",
        ],
      },
      numeroPieceIdentite: { type: String },
      datePieceIdentite: { type: Date },
      delivreePar: { type: String },
      numeroSecuriteSociale: { type: String },
      nombrePersonnesCharge: { type: Number, default: 0 },
      niveauInstruction: {
        type: String,
        enum: [
          "sans",
          "primaire",
          "moyen",
          "secondaire",
          "superieur",
          "post_graduation",
        ],
      },
      niveauQualification: {
        type: String,
        enum: [
          "sans_qualification",
          "ouvrier_specialise",
          "ouvrier_qualifie",
          "agent_maitrise",
          "technicien",
          "technicien_superieur",
          "cadre",
          "cadre_superieur",
        ],
      },
      handicape: { type: Boolean, default: false },
    },

    // Step 4: Compte en ligne / Fin
    step4: {
      email: { type: String },
      consentementRgpd: { type: Boolean, default: false },
      consentementAt: { type: Date },
    },

    // Progress tracking
    currentStep: {
      type: Number,
      default: 1,
      min: 1,
      max: 4,
    },

    formCompleted: { type: Boolean, default: false },
    formCompletedAt: { type: Date },
    formSubmittedAt: { type: Date },

    // Status
    status: {
      type: String,
      enum: [
        "draft",
        "pending",
        "pending_verification",
        "in_progress",
        "registered",
        "failed",
        "rejected",
      ],
      default: "draft",
    },

    // Verified data
    verifiedAnemId: { type: String },
    verifiedAt: { type: Date },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // Failure/rejection
    failureReason: { type: String },
    rejectionReason: { type: String },

    // Admin assignment
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
    assignedAt: { type: Date },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // PDF downloads
    pdfDownloads: [
      {
        downloadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        downloadedAt: { type: Date, default: Date.now },
        ip: { type: String },
      },
    ],

    // Admin notes
    adminNotes: [
      {
        content: { type: String, required: true },
        createdBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        createdAt: { type: Date, default: Date.now },
        isPublic: { type: Boolean, default: false },
      },
    ],

    // Audit log
    auditLog: [
      {
        action: {
          type: String,
          enum: [
            "created",
            "step_saved",
            "form_submitted",
            "pdf_downloaded",
            "assigned",
            "status_changed",
            "note_added",
            "anem_id_submitted",
            "anem_id_updated",
          ],
          required: true,
        },
        previousValue: { type: mongoose.Schema.Types.Mixed },
        newValue: { type: mongoose.Schema.Types.Mixed },
        performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        performedAt: { type: Date, default: Date.now },
        ip: { type: String },
        userAgent: { type: String },
      },
    ],

    // ANEM ID history (for resubmissions)
    anemIdHistory: [
      {
        anemId: { type: String, required: true },
        submittedAt: { type: Date, default: Date.now },
        status: {
          type: String,
          enum: ["pending", "approved", "rejected"],
          default: "pending",
        },
        reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        reviewedAt: { type: Date },
        rejectionReason: { type: String },
        adminComment: { type: String },
      },
    ],
  },
  { timestamps: true },
);

// Indexes
candidateAnemRegistrationSchema.index({ candidateId: 1 }, { unique: true });
candidateAnemRegistrationSchema.index({ userId: 1 });
candidateAnemRegistrationSchema.index({ status: 1 });
candidateAnemRegistrationSchema.index({ status: 1, createdAt: -1 });
candidateAnemRegistrationSchema.index({ assignedTo: 1, status: 1 });
candidateAnemRegistrationSchema.index({ "step2.wilayaResidence": 1 });
candidateAnemRegistrationSchema.index({ registrationType: 1, status: 1 });

// Methods
candidateAnemRegistrationSchema.methods.isRegistered = function () {
  return this.status === "registered" && this.verifiedAnemId;
};

candidateAnemRegistrationSchema.methods.addAuditEntry = function (
  action,
  performedBy,
  details = {},
  req = null,
) {
  this.auditLog.push({
    action,
    previousValue: details.previousValue,
    newValue: details.newValue,
    performedBy,
    performedAt: new Date(),
    ip: req?.ip || req?.connection?.remoteAddress,
    userAgent: req?.get?.("User-Agent") || req?.headers?.["user-agent"],
  });
};

candidateAnemRegistrationSchema.methods.getPublicNotes = function () {
  return this.adminNotes
    .filter((note) => note.isPublic)
    .sort((a, b) => b.createdAt - a.createdAt);
};

candidateAnemRegistrationSchema.methods.getLatestPublicNote = function () {
  const publicNotes = this.getPublicNotes();
  return publicNotes.length > 0 ? publicNotes[0] : null;
};

candidateAnemRegistrationSchema.virtual("effectiveAnemId").get(function () {
  return this.verifiedAnemId || null;
});

candidateAnemRegistrationSchema.methods.generatePdfData = async function () {
  await this.populate([
    { path: "candidateId", select: "telephone residence profilePicture" },
    { path: "userId", select: "nom email" },
  ]);

  return {
    documentTitle: "Demande d'inscription ANEM - Demandeur d'emploi",
    generatedAt: new Date().toISOString(),
    registrationId: this._id.toString(),
    submittedAt: this.formSubmittedAt || this.formCompletedAt,

    demandeur: {
      nom: this.userId?.nom,
      email: this.userId?.email,
    },

    etatCivil: {
      civilite: this.step1?.civilite,
      nom: this.step1?.nom,
      prenom: this.step1?.prenom,
      estPresume: this.step1?.estPresume ? "Oui" : "Non",
      numeroActeNaissance: this.step1?.numeroActeNaissance,
      dateNaissance: this.step1?.dateNaissance,
      paysNaissance: this.step1?.paysNaissance,
      wilayaNaissance: this.step1?.wilayaNaissance,
      communeNaissance: this.step1?.communeNaissance,
      situationFamiliale: this.step1?.situationFamiliale,
      situationServiceNational: this.step1?.situationServiceNational,
      nombreEnfantsCharge: this.step1?.nombreEnfantsCharge,
    },

    contact: {
      mobile: this.step2?.mobile,
      fax: this.step2?.fax,
      wilayaResidence: this.step2?.wilayaResidence,
      communeResidence: this.step2?.communeResidence,
      quartierResidence: this.step2?.quartierResidence,
      adresse: this.step2?.adresse,
      nomArabe: this.step2?.nomArabe,
      prenomArabe: this.step2?.prenomArabe,
      adresseArabe: this.step2?.adresseArabe,
    },

    autresInformations: {
      typePieceIdentite: this.step3?.typePieceIdentite,
      numeroPieceIdentite: this.step3?.numeroPieceIdentite,
      datePieceIdentite: this.step3?.datePieceIdentite,
      delivreePar: this.step3?.delivreePar,
      numeroSecuriteSociale: this.step3?.numeroSecuriteSociale,
      nombrePersonnesCharge: this.step3?.nombrePersonnesCharge,
      niveauInstruction: this.step3?.niveauInstruction,
      niveauQualification: this.step3?.niveauQualification,
      handicape: this.step3?.handicape ? "Oui" : "Non",
    },

    compteEnLigne: {
      email: this.step4?.email,
      consentementRgpd: this.step4?.consentementRgpd
        ? "Accepté"
        : "Non accepté",
      consentementAt: this.step4?.consentementAt,
    },

    legalReference:
      "Loi 18-07 relative à la protection des données personnelles",
  };
};

export default mongoose.model(
  "CandidateAnemRegistration",
  candidateAnemRegistrationSchema,
);
