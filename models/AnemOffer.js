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
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
    },

    // Recruiter's ANEM ID at the time of creation
    anemId: { type: String, required: true },

    // ── V2 Pipeline Status ──
    status: {
      type: String,
      enum: [
        "pending_review", // Phase 1: Waiting for admin
        "depositing", // Phase 2: Admin is taking it to ANEM
        "in_cooldown", // Phase 3A: ANEM accepted, 21-day wait
        "published", // Phase 3A: Cooldown done, offer live
        "failed", // Phase 3B: ANEM rejected
        "bypassed", // Phase 4: Recruiter published directly (B1)
        "redirected_classic", // Phase 4: Recruiter chose classic validation (B2)
        "deleted_by_recruiter", // Phase 4: Recruiter soft-deleted
      ],
      default: "pending_review",
    },

    // ── PDF Tracking ──
    pdfDownloaded: { type: Boolean, default: false },
    pdfDownloads: [
      {
        downloadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        downloadedAt: { type: Date, default: Date.now },
        ip: { type: String },
      },
    ],

    // ── Depositing Phase ──
    depositedAt: { type: Date },
    depositedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // ── Cooldown Phase ──
    cooldownStartedAt: { type: Date },
    cooldownEndsAt: { type: Date },
    cooldownDays: { type: Number, default: 21 },

    // ── Failure Phase ──
    failedAt: { type: Date },
    failedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    failureReason: { type: String },
    failureOption: {
      type: String,
      enum: ["allow_direct_publish", "require_classic_validation"],
    },

    // ── Recruiter Actions on Failure ──
    recruiterActionAt: { type: Date },
    recruiterAction: {
      type: String,
      enum: ["published_direct", "submitted_classic", "deleted"],
    },

    // ── Soft Delete by Recruiter ──
    deletedByRecruiterAt: { type: Date },

    // ── Publication ──
    publishedAt: { type: Date },

    // ── Admin Notes ──
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

    // ── Audit Log ──
    auditLog: [
      {
        action: {
          type: String,
          enum: [
            "created",
            "pdf_downloaded",
            "marked_depositing",
            "deposit_success",
            "deposit_failed",
            "recruiter_published_direct",
            "recruiter_submitted_classic",
            "recruiter_deleted",
            "auto_published",
            "admin_hard_deleted",
            "note_added",
          ],
          required: true,
        },
        performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        performedAt: { type: Date, default: Date.now },
        details: { type: mongoose.Schema.Types.Mixed },
        ip: { type: String },
      },
    ],
  },
  { timestamps: true },
);

// ── Indexes ──
anemOfferSchema.index({ recruiterId: 1 });
anemOfferSchema.index({ status: 1 });
anemOfferSchema.index({ status: 1, createdAt: -1 });
anemOfferSchema.index({ status: 1, failedAt: 1 });
anemOfferSchema.index({ status: 1, cooldownEndsAt: 1 });
anemOfferSchema.index({ anemId: 1 });
anemOfferSchema.index({ pdfDownloaded: 1, status: 1 });
anemOfferSchema.index({ companyId: 1 });

// ── Methods ──

anemOfferSchema.methods.addAuditEntry = function (
  action,
  performedBy,
  details = {},
  req = null,
) {
  this.auditLog.push({
    action,
    performedBy,
    performedAt: new Date(),
    details,
    ip: req?.ip || req?.connection?.remoteAddress,
  });
};

anemOfferSchema.methods.isCooldownExpired = function () {
  if (this.status !== "in_cooldown" || !this.cooldownEndsAt) return false;
  return new Date() >= this.cooldownEndsAt;
};

anemOfferSchema.methods.getDaysSinceFailure = function () {
  if (this.status !== "failed" || !this.failedAt) return null;
  return Math.floor(
    (Date.now() - this.failedAt.getTime()) / (1000 * 60 * 60 * 24),
  );
};

anemOfferSchema.methods.getCooldownRemaining = function () {
  if (this.status !== "in_cooldown" || !this.cooldownEndsAt) return null;
  const remaining = this.cooldownEndsAt.getTime() - Date.now();
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / (1000 * 60 * 60 * 24));
};

anemOfferSchema.methods.generatePdfData = async function () {
  await this.populate([
    {
      path: "offerId",
      select:
        "titre description requirements domaine type salaryMin salaryMax experienceLevel skills wilaya hiresNeeded",
    },
    { path: "recruiterId", select: "position telephone userId anem" },
    { path: "companyId", select: "name website location industry size" },
  ]);

  // Also populate recruiter's user
  if (this.recruiterId?.userId) {
    const User = mongoose.model("User");
    const user = await User.findById(this.recruiterId.userId).select(
      "nom email",
    );

    return {
      documentTitle: "Offre d'emploi - Dépôt ANEM",
      generatedAt: new Date().toISOString(),
      anemOfferId: this._id.toString(),
      anemId: this.anemId,

      offre: {
        titre: this.offerId?.titre,
        description: this.offerId?.description,
        requirements: this.offerId?.requirements,
        domaine: this.offerId?.domaine,
        type: this.offerId?.type,
        salaryMin: this.offerId?.salaryMin,
        salaryMax: this.offerId?.salaryMax,
        experienceLevel: this.offerId?.experienceLevel,
        skills: this.offerId?.skills,
        wilaya: this.offerId?.wilaya,
        hiresNeeded: this.offerId?.hiresNeeded,
      },

      entreprise: {
        name: this.companyId?.name,
        website: this.companyId?.website,
        location: this.companyId?.location,
        industry: this.companyId?.industry,
        size: this.companyId?.size,
      },

      recruteur: {
        nom: user?.nom,
        email: user?.email,
        telephone: this.recruiterId?.telephone,
        position: this.recruiterId?.position,
        anemId: this.anemId,
      },

      metadata: {
        createdAt: this.createdAt,
        status: this.status,
      },
    };
  }

  return {
    documentTitle: "Offre d'emploi - Dépôt ANEM",
    generatedAt: new Date().toISOString(),
    anemOfferId: this._id.toString(),
    anemId: this.anemId,
    offre: this.offerId,
    entreprise: this.companyId,
  };
};

// ── Statics ──

anemOfferSchema.statics.getExpiredCooldowns = async function () {
  return this.find({
    status: "in_cooldown",
    cooldownEndsAt: { $lte: new Date() },
  });
};

anemOfferSchema.statics.getStaleFailures = async function (daysThreshold = 90) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysThreshold);
  return this.find({
    status: "failed",
    failedAt: { $lte: cutoff },
  });
};

export default mongoose.model("AnemOffer", anemOfferSchema);
