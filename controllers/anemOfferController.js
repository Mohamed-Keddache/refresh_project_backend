import AnemOffer from "../models/AnemOffer.js";
import Offer from "../models/Offer.js";
import Recruiter from "../models/Recruiter.js";
import User from "../models/User.js";
import Company from "../models/Company.js";
import Notification from "../models/Notification.js";
import { logAdminAction } from "../models/AdminLog.js";
import SystemSettings from "../models/SystemSettings.js";

// ════════════════════════════════════════════════════════════════
//  RECRUITER ENDPOINTS
// ════════════════════════════════════════════════════════════════

/**
 * Check if the recruiter is eligible to create an ANEM offer
 */
export const checkAnemEligibility = async (req, res) => {
  try {
    const recruiter = await Recruiter.findOne({ userId: req.user.id });
    if (!recruiter) {
      return res.status(404).json({ msg: "Profil recruteur introuvable" });
    }

    const isAnemRegistered = recruiter.canCreateAnemOffer();

    res.json({
      isAnemRegistered,
      anemId: recruiter.anem.anemId,
      anemStatus: recruiter.anem.status,
      canCreateAnemOffer: isAnemRegistered,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Get all ANEM offers for the logged-in recruiter with their pipeline status
 */
export const getRecruiterAnemOffers = async (req, res) => {
  try {
    const recruiter = await Recruiter.findOne({ userId: req.user.id });
    if (!recruiter) {
      return res.status(404).json({ msg: "Profil recruteur introuvable" });
    }

    const anemOffers = await AnemOffer.find({
      recruiterId: recruiter._id,
      status: { $ne: "deleted_by_recruiter" }, // hide soft-deleted
    })
      .populate(
        "offerId",
        "titre actif validationStatus datePublication wilaya type",
      )
      .sort({ createdAt: -1 })
      .lean();

    const enriched = anemOffers.map((ao) => ({
      _id: ao._id,
      offerId: ao.offerId?._id,
      offerTitle: ao.offerId?.titre,
      offerActif: ao.offerId?.actif,
      offerValidationStatus: ao.offerId?.validationStatus,
      anemId: ao.anemId,
      status: ao.status,
      pdfDownloaded: ao.pdfDownloaded,
      cooldownEndsAt: ao.cooldownEndsAt,
      cooldownRemaining:
        ao.status === "in_cooldown" && ao.cooldownEndsAt
          ? Math.max(
              0,
              Math.ceil(
                (new Date(ao.cooldownEndsAt).getTime() - Date.now()) /
                  (1000 * 60 * 60 * 24),
              ),
            )
          : null,
      failureOption: ao.failureOption,
      failureReason: ao.failureReason,
      failedAt: ao.failedAt,
      publishedAt: ao.publishedAt,
      createdAt: ao.createdAt,
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Get ANEM offer status for a specific offer
 */
export const getOfferAnemStatus = async (req, res) => {
  try {
    const { offerId } = req.params;

    const recruiter = await Recruiter.findOne({ userId: req.user.id });
    if (!recruiter) {
      return res.status(404).json({ msg: "Profil recruteur introuvable" });
    }

    const offer = await Offer.findOne({
      _id: offerId,
      recruteurId: recruiter._id,
    });
    if (!offer) {
      return res.status(404).json({ msg: "Offre introuvable" });
    }

    const anemOffer = await AnemOffer.findOne({ offerId }).lean();

    if (!anemOffer) {
      return res.json({ hasAnem: false, isAnem: offer.isAnem });
    }

    res.json({
      hasAnem: true,
      isAnem: offer.isAnem,
      anemOffer: {
        _id: anemOffer._id,
        status: anemOffer.status,
        anemId: anemOffer.anemId,
        pdfDownloaded: anemOffer.pdfDownloaded,
        cooldownEndsAt: anemOffer.cooldownEndsAt,
        cooldownRemaining:
          anemOffer.status === "in_cooldown" && anemOffer.cooldownEndsAt
            ? Math.max(
                0,
                Math.ceil(
                  (new Date(anemOffer.cooldownEndsAt).getTime() - Date.now()) /
                    (1000 * 60 * 60 * 24),
                ),
              )
            : null,
        failureOption: anemOffer.failureOption,
        failureReason: anemOffer.failureReason,
        failedAt: anemOffer.failedAt,
        publishedAt: anemOffer.publishedAt,
        createdAt: anemOffer.createdAt,
      },
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Phase 4 - Recruiter publishes directly (Option B1 only)
 */
export const recruiterPublishDirect = async (req, res) => {
  try {
    const { offerId } = req.params;

    const recruiter = await Recruiter.findOne({ userId: req.user.id });
    if (!recruiter) {
      return res.status(404).json({ msg: "Profil recruteur introuvable" });
    }

    const anemOffer = await AnemOffer.findOne({
      offerId,
      recruiterId: recruiter._id,
    });

    if (!anemOffer) {
      return res.status(404).json({ msg: "Offre ANEM introuvable" });
    }

    if (anemOffer.status !== "failed") {
      return res.status(400).json({
        msg: "Cette action n'est possible que pour les offres en échec ANEM",
        currentStatus: anemOffer.status,
      });
    }

    if (anemOffer.failureOption !== "allow_direct_publish") {
      return res.status(403).json({
        msg: "L'administration n'a pas autorisé la publication directe. Vous devez soumettre au circuit classique.",
        failureOption: anemOffer.failureOption,
      });
    }

    // Update AnemOffer
    anemOffer.status = "bypassed";
    anemOffer.recruiterActionAt = new Date();
    anemOffer.recruiterAction = "published_direct";
    anemOffer.publishedAt = new Date();
    anemOffer.addAuditEntry("recruiter_published_direct", req.user.id, {}, req);
    await anemOffer.save();

    // Publish the offer
    const offer = await Offer.findById(offerId);
    if (!offer || offer.actif === false) {
      anemOffer.status = "deleted_by_recruiter";
      await anemOffer.save();

      return res.status(400).json({
        msg: "Impossible de publier une offre fermée ou supprimée",
      });
    }
    offer.validationStatus = "approved";
    offer.actif = true;
    offer.datePublication = new Date();
    offer.validationHistory.push({
      status: "approved",
      message: "Publication directe après échec ANEM (autorisée par admin)",
      date: new Date(),
    });
    await offer.save();

    res.json({
      msg: "Offre publiée avec succès ✅",
      offer: {
        _id: offer._id,
        titre: offer.titre,
        actif: offer.actif,
        validationStatus: offer.validationStatus,
      },
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Phase 4 - Recruiter submits to classic validation (Option B2)
 */
export const recruiterSubmitClassic = async (req, res) => {
  try {
    const { offerId } = req.params;

    const recruiter = await Recruiter.findOne({ userId: req.user.id });
    if (!recruiter) {
      return res.status(404).json({ msg: "Profil recruteur introuvable" });
    }

    const anemOffer = await AnemOffer.findOne({
      offerId,
      recruiterId: recruiter._id,
    });

    if (!anemOffer) {
      return res.status(404).json({ msg: "Offre ANEM introuvable" });
    }

    if (anemOffer.status !== "failed") {
      return res.status(400).json({
        msg: "Cette action n'est possible que pour les offres en échec ANEM",
        currentStatus: anemOffer.status,
      });
    }

    // Update AnemOffer
    anemOffer.status = "redirected_classic";
    anemOffer.recruiterActionAt = new Date();
    anemOffer.recruiterAction = "submitted_classic";
    anemOffer.addAuditEntry(
      "recruiter_submitted_classic",
      req.user.id,
      {},
      req,
    );
    await anemOffer.save();

    // Send offer to classic validation pipeline
    const offer = await Offer.findById(offerId);
    offer.validationStatus = "pending";
    offer.isAnem = false; // No longer ANEM
    offer.validationHistory.push({
      status: "pending",
      message: "Soumis au circuit classique après échec ANEM",
      date: new Date(),
    });
    await offer.save();

    // Notify admins
    const admins = await User.find({ role: "admin" });
    const notifPromises = admins.map((admin) =>
      Notification.create({
        userId: admin._id,
        message: `Offre "${offer.titre}" soumise en validation classique après échec ANEM`,
        type: "info",
      }),
    );
    await Promise.all(notifPromises);

    res.json({
      msg: "Offre soumise au circuit de validation classique ✅",
      offer: {
        _id: offer._id,
        titre: offer.titre,
        validationStatus: offer.validationStatus,
      },
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Phase 4 - Recruiter soft deletes offer
 */
export const recruiterDeleteAnemOffer = async (req, res) => {
  try {
    const { offerId } = req.params;

    const recruiter = await Recruiter.findOne({ userId: req.user.id });
    if (!recruiter) {
      return res.status(404).json({ msg: "Profil recruteur introuvable" });
    }

    const anemOffer = await AnemOffer.findOne({
      offerId,
      recruiterId: recruiter._id,
    });

    if (!anemOffer) {
      return res.status(404).json({ msg: "Offre ANEM introuvable" });
    }

    // Allow deletion from failed status or pending_review
    const deletableStatuses = ["failed", "pending_review"];
    if (!deletableStatuses.includes(anemOffer.status)) {
      return res.status(400).json({
        msg: "Impossible de supprimer cette offre dans son état actuel",
        currentStatus: anemOffer.status,
      });
    }

    // Soft delete AnemOffer
    anemOffer.status = "deleted_by_recruiter";
    anemOffer.deletedByRecruiterAt = new Date();
    anemOffer.recruiterActionAt = new Date();
    anemOffer.recruiterAction = "deleted";
    anemOffer.addAuditEntry("recruiter_deleted", req.user.id, {}, req);
    await anemOffer.save();

    // Soft delete the Offer
    const offer = await Offer.findById(offerId);
    offer.isDeletedByRecruiter = true;
    offer.deletedByRecruiterAt = new Date();
    offer.actif = false;
    await offer.save();

    res.json({ msg: "Offre supprimée avec succès" });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// ════════════════════════════════════════════════════════════════
//  ADMIN ENDPOINTS
// ════════════════════════════════════════════════════════════════

/**
 * Phase 5 - Admin: Get ANEM offers with advanced filters
 */
export const getAdminAnemOffers = async (req, res) => {
  try {
    const {
      status,
      anemId,
      search,
      pdfDownloaded,
      failedSinceDays,
      dateFrom,
      dateTo,
      sortBy = "createdAt",
      sortOrder = "desc",
      page = 1,
      limit = 20,
    } = req.query;

    let query = {};

    // Status filter
    if (status) {
      if (status === "all") {
        // Show everything except hard-deleted
      } else if (status === "active_pipeline") {
        query.status = { $in: ["pending_review", "depositing", "in_cooldown"] };
      } else {
        query.status = status;
      }
    } else {
      // Default: exclude deleted_by_recruiter from main view unless explicitly requested
      query.status = { $ne: "deleted_by_recruiter" };
    }

    // Search by ANEM ID
    if (anemId) {
      query.anemId = { $regex: anemId, $options: "i" };
    }

    // PDF filter
    if (pdfDownloaded === "true") {
      query.pdfDownloaded = true;
    } else if (pdfDownloaded === "false") {
      query.pdfDownloaded = false;
    }

    // Failed since X days
    if (failedSinceDays && status === "failed") {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - parseInt(failedSinceDays));
      query.failedAt = { $lte: cutoff };
    }

    // Date range
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    // Text search (offer title, company name)
    if (search) {
      const searchRegex = { $regex: search, $options: "i" };

      // Find matching offers
      const matchingOffers = await Offer.find({
        titre: searchRegex,
      }).select("_id");
      const offerIds = matchingOffers.map((o) => o._id);

      // Find matching companies
      const matchingCompanies = await Company.find({
        name: searchRegex,
      }).select("_id");
      const companyIds = matchingCompanies.map((c) => c._id);

      // Find matching recruiters by user name
      const matchingUsers = await User.find({
        nom: searchRegex,
      }).select("_id");
      const userIds = matchingUsers.map((u) => u._id);
      const matchingRecruiters = await Recruiter.find({
        userId: { $in: userIds },
      }).select("_id");
      const recruiterIds = matchingRecruiters.map((r) => r._id);

      query.$or = [
        { offerId: { $in: offerIds } },
        { companyId: { $in: companyIds } },
        { recruiterId: { $in: recruiterIds } },
        { anemId: searchRegex },
      ];
    }

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

    const [anemOffers, total, statusCounts] = await Promise.all([
      AnemOffer.find(query)
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .populate(
          "offerId",
          "titre type wilaya salaryMin salaryMax hiresNeeded",
        )
        .populate("companyId", "name logo")
        .populate({
          path: "recruiterId",
          select: "userId position telephone anem",
          populate: { path: "userId", select: "nom email" },
        })
        .populate("depositedBy", "nom")
        .populate("failedBy", "nom")
        .lean(),
      AnemOffer.countDocuments(query),
      AnemOffer.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    ]);

    const enriched = anemOffers.map((ao) => ({
      _id: ao._id,
      offerId: ao.offerId?._id,
      offerTitle: ao.offerId?.titre,
      offerType: ao.offerId?.type,
      offerWilaya: ao.offerId?.wilaya,
      hiresNeeded: ao.offerId?.hiresNeeded,
      anemId: ao.anemId,
      status: ao.status,
      pdfDownloaded: ao.pdfDownloaded,
      pdfDownloadCount: ao.pdfDownloads?.length || 0,
      company: {
        _id: ao.companyId?._id,
        name: ao.companyId?.name,
        logo: ao.companyId?.logo,
      },
      recruiter: {
        _id: ao.recruiterId?._id,
        nom: ao.recruiterId?.userId?.nom,
        email: ao.recruiterId?.userId?.email,
      },
      depositedAt: ao.depositedAt,
      depositedBy: ao.depositedBy?.nom,
      cooldownEndsAt: ao.cooldownEndsAt,
      cooldownRemaining:
        ao.status === "in_cooldown" && ao.cooldownEndsAt
          ? Math.max(
              0,
              Math.ceil(
                (new Date(ao.cooldownEndsAt).getTime() - Date.now()) /
                  (1000 * 60 * 60 * 24),
              ),
            )
          : null,
      failedAt: ao.failedAt,
      failedBy: ao.failedBy?.nom,
      failureReason: ao.failureReason,
      failureOption: ao.failureOption,
      daysSinceFailure:
        ao.status === "failed" && ao.failedAt
          ? Math.floor(
              (Date.now() - new Date(ao.failedAt).getTime()) /
                (1000 * 60 * 60 * 24),
            )
          : null,
      recruiterAction: ao.recruiterAction,
      recruiterActionAt: ao.recruiterActionAt,
      publishedAt: ao.publishedAt,
      createdAt: ao.createdAt,
    }));

    const countsMap = {};
    statusCounts.forEach((s) => {
      countsMap[s._id] = s.count;
    });

    res.json({
      data: enriched,
      meta: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit),
      },
      statusCounts: countsMap,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Admin: Get PDF data for a single ANEM offer
 */
export const getAnemOfferPdfData = async (req, res) => {
  try {
    const { anemOfferId } = req.params;

    const anemOffer = await AnemOffer.findById(anemOfferId);
    if (!anemOffer) {
      return res.status(404).json({ msg: "Offre ANEM introuvable" });
    }

    // Track download
    anemOffer.pdfDownloaded = true;
    anemOffer.pdfDownloads.push({
      downloadedBy: req.user.id,
      downloadedAt: new Date(),
      ip: req.ip || req.connection?.remoteAddress,
    });
    anemOffer.addAuditEntry("pdf_downloaded", req.user.id, {}, req);
    await anemOffer.save();

    const pdfData = await anemOffer.generatePdfData();

    await logAdminAction(
      req.user.id,
      "anem_offer_pdf_downloaded",
      { type: "anem_offer", id: anemOffer._id },
      { offerId: anemOffer.offerId },
      req,
    );

    res.json(pdfData);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Admin: Bulk get PDF data for multiple ANEM offers
 */
export const bulkGetAnemOfferPdfData = async (req, res) => {
  try {
    const { anemOfferIds } = req.body;

    if (
      !anemOfferIds ||
      !Array.isArray(anemOfferIds) ||
      anemOfferIds.length === 0
    ) {
      return res.status(400).json({ msg: "IDs des offres ANEM requis" });
    }

    if (anemOfferIds.length > 50) {
      return res.status(400).json({ msg: "Maximum 50 offres à la fois" });
    }

    const results = [];

    for (const id of anemOfferIds) {
      try {
        const anemOffer = await AnemOffer.findById(id);
        if (!anemOffer) {
          results.push({ id, success: false, error: "Introuvable" });
          continue;
        }

        // Track download
        anemOffer.pdfDownloaded = true;
        anemOffer.pdfDownloads.push({
          downloadedBy: req.user.id,
          downloadedAt: new Date(),
          ip: req.ip,
        });
        anemOffer.addAuditEntry(
          "pdf_downloaded",
          req.user.id,
          { bulk: true },
          req,
        );
        await anemOffer.save();

        const pdfData = await anemOffer.generatePdfData();
        results.push({ id, success: true, data: pdfData });
      } catch (err) {
        results.push({ id, success: false, error: err.message });
      }
    }

    await logAdminAction(
      req.user.id,
      "anem_offer_bulk_pdf_downloaded",
      { type: "anem_offer" },
      {
        count: anemOfferIds.length,
        successCount: results.filter((r) => r.success).length,
      },
      req,
    );

    res.json({
      msg: `${results.filter((r) => r.success).length}/${anemOfferIds.length} PDF générés`,
      results,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Phase 2 - Admin: Mark offer(s) as depositing
 */
export const markAsDepositing = async (req, res) => {
  try {
    const { anemOfferIds } = req.body;

    if (
      !anemOfferIds ||
      !Array.isArray(anemOfferIds) ||
      anemOfferIds.length === 0
    ) {
      return res.status(400).json({ msg: "IDs des offres ANEM requis" });
    }

    const results = { success: [], failed: [] };

    for (const id of anemOfferIds) {
      try {
        const anemOffer = await AnemOffer.findById(id);
        if (!anemOffer) {
          results.failed.push({ id, reason: "Introuvable" });
          continue;
        }

        if (anemOffer.status !== "pending_review") {
          results.failed.push({
            id,
            reason: `Statut actuel "${anemOffer.status}" ne permet pas cette action`,
          });
          continue;
        }

        anemOffer.status = "depositing";
        anemOffer.depositedAt = new Date();
        anemOffer.depositedBy = req.user.id;
        anemOffer.addAuditEntry("marked_depositing", req.user.id, {}, req);
        await anemOffer.save();

        results.success.push(id);
      } catch (err) {
        results.failed.push({ id, reason: err.message });
      }
    }

    await logAdminAction(
      req.user.id,
      anemOfferIds.length > 1
        ? "anem_offer_bulk_marked_depositing"
        : "anem_offer_marked_depositing",
      { type: "anem_offer" },
      { count: anemOfferIds.length, successCount: results.success.length },
      req,
    );

    res.json({
      msg: `${results.success.length} offre(s) marquée(s) en cours de dépôt`,
      results,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Shortcut: Mark all downloaded PDFs as depositing
 */
export const markDownloadedAsDepositing = async (req, res) => {
  try {
    const downloadedOffers = await AnemOffer.find({
      status: "pending_review",
      pdfDownloaded: true,
    });

    if (downloadedOffers.length === 0) {
      return res.json({
        msg: "Aucune offre téléchargée en attente",
        count: 0,
      });
    }

    const ids = downloadedOffers.map((o) => o._id);

    // Reuse the bulk function logic
    req.body = { anemOfferIds: ids };
    return markAsDepositing(req, res);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Phase 3A - Admin: Mark deposit as successful (starts cooldown)
 */
export const markDepositSuccess = async (req, res) => {
  try {
    const { anemOfferId } = req.params;
    const { cooldownDays, comment } = req.body;

    const anemOffer = await AnemOffer.findById(anemOfferId);
    if (!anemOffer) {
      return res.status(404).json({ msg: "Offre ANEM introuvable" });
    }

    if (anemOffer.status !== "depositing") {
      return res.status(400).json({
        msg: "Seules les offres en cours de dépôt peuvent recevoir ce statut",
        currentStatus: anemOffer.status,
      });
    }

    const days = cooldownDays || 21;
    const cooldownEnd = new Date();
    cooldownEnd.setDate(cooldownEnd.getDate() + days);

    anemOffer.status = "in_cooldown";
    anemOffer.cooldownStartedAt = new Date();
    anemOffer.cooldownEndsAt = cooldownEnd;
    anemOffer.cooldownDays = days;
    anemOffer.addAuditEntry(
      "deposit_success",
      req.user.id,
      { cooldownDays: days },
      req,
    );

    if (comment) {
      anemOffer.adminNotes.push({
        content: comment,
        createdBy: req.user.id,
        isPublic: true,
      });
    }

    await anemOffer.save();

    // Notify recruiter
    const recruiter = await Recruiter.findById(anemOffer.recruiterId);
    if (recruiter) {
      const offer = await Offer.findById(anemOffer.offerId);
      await Notification.create({
        userId: recruiter.userId,
        message: `Bonne nouvelle ! Votre offre "${offer?.titre}" a été déposée à l'ANEM avec succès. Elle sera publiée automatiquement dans ${days} jours.`,
        type: "validation",
      });
    }

    await logAdminAction(
      req.user.id,
      "anem_offer_deposit_success",
      { type: "anem_offer", id: anemOffer._id },
      { cooldownDays: days, cooldownEndsAt: cooldownEnd },
      req,
    );

    res.json({
      msg: `Dépôt réussi. L'offre sera publiée automatiquement dans ${days} jours.`,
      cooldownEndsAt: cooldownEnd,
      cooldownDays: days,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Phase 3B - Admin: Mark deposit as failed
 */
export const markDepositFailed = async (req, res) => {
  try {
    const { anemOfferId } = req.params;
    const { reason, failureOption, comment } = req.body;

    if (
      !failureOption ||
      !["allow_direct_publish", "require_classic_validation"].includes(
        failureOption,
      )
    ) {
      return res.status(400).json({
        msg: "Option de traitement requise: 'allow_direct_publish' ou 'require_classic_validation'",
      });
    }

    const anemOffer = await AnemOffer.findById(anemOfferId);
    if (!anemOffer) {
      return res.status(404).json({ msg: "Offre ANEM introuvable" });
    }

    if (anemOffer.status !== "depositing") {
      return res.status(400).json({
        msg: "Seules les offres en cours de dépôt peuvent recevoir ce statut",
        currentStatus: anemOffer.status,
      });
    }

    anemOffer.status = "failed";
    anemOffer.failedAt = new Date();
    anemOffer.failedBy = req.user.id;
    anemOffer.failureReason = reason || "Refusé par l'ANEM";
    anemOffer.failureOption = failureOption;
    anemOffer.addAuditEntry(
      "deposit_failed",
      req.user.id,
      { reason, failureOption },
      req,
    );

    if (comment) {
      anemOffer.adminNotes.push({
        content: comment,
        createdBy: req.user.id,
        isPublic: true,
      });
    }

    await anemOffer.save();

    // Notify recruiter with appropriate message
    const recruiter = await Recruiter.findById(anemOffer.recruiterId);
    if (recruiter) {
      const offer = await Offer.findById(anemOffer.offerId);
      const optionMsg =
        failureOption === "allow_direct_publish"
          ? "Vous pouvez publier votre offre directement ou la supprimer."
          : "Vous pouvez la soumettre au circuit de validation classique ou la supprimer.";

      await Notification.create({
        userId: recruiter.userId,
        message: `Votre offre "${offer?.titre}" n'a pas été acceptée par l'ANEM. ${optionMsg}`,
        type: "alerte",
      });
    }

    await logAdminAction(
      req.user.id,
      "anem_offer_deposit_failed",
      { type: "anem_offer", id: anemOffer._id },
      { reason, failureOption },
      req,
    );

    res.json({
      msg: "Échec du dépôt enregistré. Le recruteur a été notifié.",
      failureOption,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Admin: Add note to ANEM offer
 */
export const addAnemOfferNote = async (req, res) => {
  try {
    const { anemOfferId } = req.params;
    const { note, isPublic = false } = req.body;

    if (!note || note.trim().length === 0) {
      return res.status(400).json({ msg: "Note requise" });
    }

    const anemOffer = await AnemOffer.findById(anemOfferId);
    if (!anemOffer) {
      return res.status(404).json({ msg: "Offre ANEM introuvable" });
    }

    anemOffer.adminNotes.push({
      content: note.trim(),
      createdBy: req.user.id,
      isPublic,
    });
    anemOffer.addAuditEntry("note_added", req.user.id, { isPublic }, req);
    await anemOffer.save();

    // If public note, notify recruiter
    if (isPublic) {
      const recruiter = await Recruiter.findById(anemOffer.recruiterId);
      if (recruiter) {
        await Notification.create({
          userId: recruiter.userId,
          message: `Mise à jour sur votre offre ANEM: ${note.substring(0, 100)}${note.length > 100 ? "..." : ""}`,
          type: "info",
        });
      }
    }

    await logAdminAction(
      req.user.id,
      "anem_offer_note_added",
      { type: "anem_offer", id: anemOffer._id },
      { isPublic },
      req,
    );

    const user = await User.findById(req.user.id).select("nom");

    res.json({
      msg: "Note ajoutée",
      note: {
        content: note.trim(),
        createdAt: new Date(),
        createdBy: { nom: user.nom },
        isPublic,
      },
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Admin: Get details of a single ANEM offer
 */
export const getAnemOfferDetails = async (req, res) => {
  try {
    const { anemOfferId } = req.params;

    const anemOffer = await AnemOffer.findById(anemOfferId)
      .populate({
        path: "offerId",
        populate: { path: "companyId", select: "name logo website location" },
      })
      .populate({
        path: "recruiterId",
        select: "userId position telephone anem status",
        populate: { path: "userId", select: "nom email" },
      })
      .populate("companyId", "name logo website location industry size")
      .populate("depositedBy", "nom")
      .populate("failedBy", "nom")
      .populate("adminNotes.createdBy", "nom")
      .populate("auditLog.performedBy", "nom")
      .populate("pdfDownloads.downloadedBy", "nom");

    if (!anemOffer) {
      return res.status(404).json({ msg: "Offre ANEM introuvable" });
    }

    res.json(anemOffer);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Admin: View soft-deleted offers (with "Supprimée par le recruteur" tag)
 */
export const getDeletedAnemOffers = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const [offers, total] = await Promise.all([
      AnemOffer.find({ status: "deleted_by_recruiter" })
        .sort({ deletedByRecruiterAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate("offerId", "titre type wilaya")
        .populate("companyId", "name logo")
        .populate({
          path: "recruiterId",
          select: "userId",
          populate: { path: "userId", select: "nom" },
        })
        .lean(),
      AnemOffer.countDocuments({ status: "deleted_by_recruiter" }),
    ]);

    res.json({
      data: offers.map((ao) => ({
        _id: ao._id,
        offerId: ao.offerId?._id,
        offerTitle: ao.offerId?.titre,
        anemId: ao.anemId,
        company: ao.companyId?.name,
        recruiter: ao.recruiterId?.userId?.nom,
        deletedAt: ao.deletedByRecruiterAt,
        createdAt: ao.createdAt,
      })),
      meta: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Phase 6 - Admin: Hard delete ANEM offer(s)
 */
export const hardDeleteAnemOffers = async (req, res) => {
  try {
    const { anemOfferIds } = req.body;

    if (
      !anemOfferIds ||
      !Array.isArray(anemOfferIds) ||
      anemOfferIds.length === 0
    ) {
      return res.status(400).json({ msg: "IDs requis" });
    }

    const results = { success: [], failed: [] };

    for (const id of anemOfferIds) {
      try {
        const anemOffer = await AnemOffer.findById(id);
        if (!anemOffer) {
          results.failed.push({ id, reason: "Introuvable" });
          continue;
        }

        // Also delete the associated offer
        await Offer.findByIdAndDelete(anemOffer.offerId);
        await AnemOffer.findByIdAndDelete(id);

        results.success.push(id);
      } catch (err) {
        results.failed.push({ id, reason: err.message });
      }
    }

    await logAdminAction(
      req.user.id,
      anemOfferIds.length > 1
        ? "anem_offer_bulk_hard_deleted"
        : "anem_offer_hard_deleted",
      { type: "anem_offer" },
      { count: anemOfferIds.length, successCount: results.success.length },
      req,
    );

    res.json({
      msg: `${results.success.length} offre(s) supprimée(s) définitivement`,
      results,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Admin: Get ANEM offer stats for dashboard
 */
export const getAnemOfferStats = async (req, res) => {
  try {
    const [
      statusCounts,
      cooldownExpiringSoon,
      staleFailures7,
      staleFailures30,
    ] = await Promise.all([
      AnemOffer.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),

      // Offers expiring in next 3 days
      AnemOffer.countDocuments({
        status: "in_cooldown",
        cooldownEndsAt: {
          $lte: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
          $gte: new Date(),
        },
      }),

      // Failures > 7 days
      (() => {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        return AnemOffer.countDocuments({
          status: "failed",
          failedAt: { $lte: d },
        });
      })(),

      // Failures > 30 days
      (() => {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        return AnemOffer.countDocuments({
          status: "failed",
          failedAt: { $lte: d },
        });
      })(),
    ]);

    const countsMap = {};
    statusCounts.forEach((s) => {
      countsMap[s._id] = s.count;
    });

    // Get auto-cleanup setting
    const autoCleanupEnabled = await SystemSettings.getSetting(
      "anem_offer_auto_cleanup_enabled",
      false,
    );
    const autoCleanupDays = await SystemSettings.getSetting(
      "anem_offer_auto_cleanup_days",
      90,
    );

    res.json({
      overview: {
        pendingReview: countsMap["pending_review"] || 0,
        depositing: countsMap["depositing"] || 0,
        inCooldown: countsMap["in_cooldown"] || 0,
        published: countsMap["published"] || 0,
        failed: countsMap["failed"] || 0,
        bypassed: countsMap["bypassed"] || 0,
        redirectedClassic: countsMap["redirected_classic"] || 0,
        deletedByRecruiter: countsMap["deleted_by_recruiter"] || 0,
      },
      alerts: {
        cooldownExpiringSoon,
        staleFailures7,
        staleFailures30,
      },
      settings: {
        autoCleanupEnabled,
        autoCleanupDays,
      },
      statusCounts: countsMap,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Admin: Toggle auto-cleanup setting
 */
export const toggleAutoCleanup = async (req, res) => {
  try {
    const { enabled, days } = req.body;

    if (enabled !== undefined) {
      await SystemSettings.setSetting(
        "anem_offer_auto_cleanup_enabled",
        enabled,
        "Active la suppression automatique des offres ANEM en échec après X jours",
        req.user.id,
      );
    }

    if (days !== undefined) {
      if (days < 30 || days > 365) {
        return res
          .status(400)
          .json({ msg: "Le délai doit être entre 30 et 365 jours" });
      }
      await SystemSettings.setSetting(
        "anem_offer_auto_cleanup_days",
        days,
        "Nombre de jours avant suppression automatique des échecs ANEM",
        req.user.id,
      );
    }

    res.json({
      msg: "Paramètres de nettoyage automatique mis à jour",
      enabled:
        enabled ??
        (await SystemSettings.getSetting(
          "anem_offer_auto_cleanup_enabled",
          false,
        )),
      days:
        days ??
        (await SystemSettings.getSetting("anem_offer_auto_cleanup_days", 90)),
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// ════════════════════════════════════════════════════════════════
//  SCHEDULED TASKS (called from server.js)
// ════════════════════════════════════════════════════════════════

/**
 * Auto-publish offers whose cooldown has expired
 */
export const processExpiredCooldowns = async () => {
  try {
    const expiredOffers = await AnemOffer.getExpiredCooldowns();
    let publishedCount = 0;

    for (const anemOffer of expiredOffers) {
      try {
        // Publish the offer
        const offer = await Offer.findById(anemOffer.offerId);
        if (!offer) continue;

        offer.validationStatus = "approved";
        offer.actif = true;
        offer.datePublication = new Date();
        offer.validationHistory.push({
          status: "approved",
          message: "Publication automatique après délai ANEM de 21 jours",
          date: new Date(),
        });
        await offer.save();

        // Update AnemOffer
        anemOffer.status = "published";
        anemOffer.publishedAt = new Date();
        anemOffer.addAuditEntry("auto_published", null, {
          cooldownDays: anemOffer.cooldownDays,
        });
        await anemOffer.save();

        // Notify recruiter
        const recruiter = await Recruiter.findById(anemOffer.recruiterId);
        if (recruiter) {
          await Notification.create({
            userId: recruiter.userId,
            message: `Votre offre "${offer.titre}" est maintenant publiée après le délai ANEM ! 🎉`,
            type: "validation",
          });
        }

        publishedCount++;
      } catch (err) {
        console.error(
          `Error auto-publishing ANEM offer ${anemOffer._id}:`,
          err,
        );
      }
    }

    return publishedCount;
  } catch (err) {
    console.error("Error processing expired cooldowns:", err);
    return 0;
  }
};

/**
 * Auto-cleanup stale failures (hard delete)
 */
export const processAutoCleanup = async () => {
  try {
    const enabled = await SystemSettings.getSetting(
      "anem_offer_auto_cleanup_enabled",
      false,
    );
    if (!enabled) return 0;

    const days = await SystemSettings.getSetting(
      "anem_offer_auto_cleanup_days",
      90,
    );
    const staleOffers = await AnemOffer.getStaleFailures(days);
    let deletedCount = 0;

    for (const anemOffer of staleOffers) {
      try {
        await Offer.findByIdAndDelete(anemOffer.offerId);
        await AnemOffer.findByIdAndDelete(anemOffer._id);
        deletedCount++;
      } catch (err) {
        console.error(
          `Error auto-deleting stale ANEM offer ${anemOffer._id}:`,
          err,
        );
      }
    }

    if (deletedCount > 0) {
      console.log(
        `🧹 ANEM auto-cleanup: ${deletedCount} offre(s) supprimée(s) (>${days} jours en échec)`,
      );
    }

    return deletedCount;
  } catch (err) {
    console.error("Error processing auto-cleanup:", err);
    return 0;
  }
};

// ════════════════════════════════════════════════════════════════
//  INTERNAL HELPER (called from recruiterController.createOffer)
// ════════════════════════════════════════════════════════════════

/**
 * Create a V2 AnemOffer entry when recruiter creates an offer with ANEM
 */
export const createAnemOfferV2 = async (
  offerId,
  recruiterId,
  companyId,
  anemId,
  anemRegistrationId,
) => {
  const anemOffer = new AnemOffer({
    offerId,
    recruiterId,
    companyId,
    anemId,
    anemRegistrationId,
    status: "pending_review",
  });

  anemOffer.addAuditEntry("created", null, { anemId });
  await anemOffer.save();
  return anemOffer;
};
