// === models/AnemRegistration.js ===
import mongoose from "mongoose";

const anemRegistrationSchema = new mongoose.Schema(
  {
    recruiterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Recruiter",
      required: true,
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Registration type
    registrationType: {
      type: String,
      enum: ["self_declared", "site_registration"],
      required: true,
    },

    // For self-declared (recruiter claims to already have ANEM ID)
    declaredAnemId: { type: String },
    declaredAt: { type: Date },

    // For site registration - Step 1: Informations générales
    step1: {
      typeAffiliation: {
        type: String,
        enum: ["CNAS", "CASNOS"],
      },
      numeroCnas: { type: String },
      rib: { type: String },
      raisonSociale: { type: String },
      denominationCommerciale: { type: String },
      numeroRc: { type: String },
      entrepriseEtrangere: { type: Boolean, default: false },
      responsable: { type: String },
      fonction: { type: String },
      nif: { type: String },
    },

    // Step 2: Informations de l'employeur
    step2: {
      secteurActivite: { type: String },
      brancheActivite: { type: String },
      secteurJuridique: { type: String },
      statutJuridique: { type: String },
      adresse: { type: String },
      telephone: { type: String },
      fax: { type: String },
      mobile: { type: String },
      paysOrigine: { type: String, default: "Algérie" },
      wilaya: { type: String },
      commune: { type: String },
      codePostal: { type: String },
    },

    // Step 3: Informations CNAS
    step3: {
      effectifDeclare: { type: Number },
      dontInseresCta: { type: Number },
      nombreInseresDaip: { type: Number },
      autresIndications: { type: String },
    },

    // Step 4: Compte en ligne
    step4: {
      email: { type: String },
      // Password is NOT stored - only used for ANEM registration
      consentementRgpd: { type: Boolean, default: false },
      consentementAt: { type: Date },
    },

    // Current step progress (1-4)
    currentStep: {
      type: Number,
      default: 1,
      min: 1,
      max: 4,
    },

    // Form completion status
    formCompleted: { type: Boolean, default: false },
    formCompletedAt: { type: Date },
    formSubmittedAt: { type: Date },

    // Status tracking
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

    // Verified ANEM ID (assigned after successful registration)
    verifiedAnemId: { type: String },
    verifiedAt: { type: Date },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // Failure/rejection reason
    failureReason: { type: String },
    rejectionReason: { type: String },

    // Admin assignment
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
    assignedAt: { type: Date },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // PDF download tracking (not storing PDF, just tracking downloads)
    pdfDownloads: [
      {
        downloadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        downloadedAt: { type: Date, default: Date.now },
        ip: { type: String },
      },
    ],

    // Admin notes (visible to recruiter as latest status updates)
    adminNotes: [
      {
        content: { type: String, required: true },
        createdBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        createdAt: { type: Date, default: Date.now },
        isPublic: { type: Boolean, default: false }, // If true, visible to recruiter
      },
    ],

    // Audit log for admin tracking
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

    // History of declared ANEM IDs (for re-submissions after rejection)
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
anemRegistrationSchema.index({ recruiterId: 1 }, { unique: true });
anemRegistrationSchema.index({ userId: 1 });
anemRegistrationSchema.index({ companyId: 1 });
anemRegistrationSchema.index({ status: 1 });
anemRegistrationSchema.index({ status: 1, createdAt: -1 });
anemRegistrationSchema.index({ assignedTo: 1, status: 1 });
anemRegistrationSchema.index({ "step2.wilaya": 1 });
anemRegistrationSchema.index({ registrationType: 1, status: 1 });

// Methods
anemRegistrationSchema.methods.isRegistered = function () {
  return this.status === "registered" && this.verifiedAnemId;
};

anemRegistrationSchema.methods.canCreateAnemOffer = function () {
  return this.status === "registered" && this.verifiedAnemId;
};

anemRegistrationSchema.methods.addAuditEntry = function (
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

anemRegistrationSchema.methods.getPublicNotes = function () {
  return this.adminNotes
    .filter((note) => note.isPublic)
    .sort((a, b) => b.createdAt - a.createdAt);
};

anemRegistrationSchema.methods.getLatestPublicNote = function () {
  const publicNotes = this.getPublicNotes();
  return publicNotes.length > 0 ? publicNotes[0] : null;
};

// Virtual for getting effective ANEM ID
anemRegistrationSchema.virtual("effectiveAnemId").get(function () {
  return this.verifiedAnemId || null;
});

// Generate JSON data for PDF conversion (frontend will convert to PDF)
anemRegistrationSchema.methods.generatePdfData = async function () {
  await this.populate([
    { path: "recruiterId", select: "position telephone" },
    { path: "userId", select: "nom email" },
    { path: "companyId", select: "name website location" },
  ]);

  return {
    // Header
    documentTitle: "Demande d'inscription ANEM",
    generatedAt: new Date().toISOString(),
    registrationId: this._id.toString(),
    submittedAt: this.formSubmittedAt || this.formCompletedAt,

    // Recruiter Info
    recruiter: {
      nom: this.userId?.nom,
      email: this.userId?.email,
      telephone: this.recruiterId?.telephone,
      position: this.recruiterId?.position,
    },

    // Company Info
    company: {
      name: this.companyId?.name,
      website: this.companyId?.website,
      location: this.companyId?.location,
    },

    // Step 1: Informations générales
    informationsGenerales: {
      typeAffiliation: this.step1?.typeAffiliation,
      numeroCnas: this.step1?.numeroCnas,
      rib: this.step1?.rib,
      raisonSociale: this.step1?.raisonSociale,
      denominationCommerciale: this.step1?.denominationCommerciale,
      numeroRc: this.step1?.numeroRc,
      entrepriseEtrangere: this.step1?.entrepriseEtrangere ? "Oui" : "Non",
      responsable: this.step1?.responsable,
      fonction: this.step1?.fonction,
      nif: this.step1?.nif,
    },

    // Step 2: Informations de l'employeur
    informationsEmployeur: {
      secteurActivite: this.step2?.secteurActivite,
      brancheActivite: this.step2?.brancheActivite,
      secteurJuridique: this.step2?.secteurJuridique,
      statutJuridique: this.step2?.statutJuridique,
      adresse: this.step2?.adresse,
      telephone: this.step2?.telephone,
      fax: this.step2?.fax,
      mobile: this.step2?.mobile,
      paysOrigine: this.step2?.paysOrigine,
      wilaya: this.step2?.wilaya,
      commune: this.step2?.commune,
      codePostal: this.step2?.codePostal,
    },

    // Step 3: Informations CNAS
    informationsCnas: {
      effectifDeclare: this.step3?.effectifDeclare,
      dontInseresCta: this.step3?.dontInseresCta,
      nombreInseresDaip: this.step3?.nombreInseresDaip,
      autresIndications: this.step3?.autresIndications,
    },

    // Step 4: Compte en ligne
    compteEnLigne: {
      email: this.step4?.email,
      consentementRgpd: this.step4?.consentementRgpd
        ? "Accepté"
        : "Non accepté",
      consentementAt: this.step4?.consentementAt,
    },

    // Legal text reference
    legalReference:
      "Loi 18-07 relative à la protection des données personnelles",
  };
};

export default mongoose.model("AnemRegistration", anemRegistrationSchema);
