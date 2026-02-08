import User from "../models/User.js";
import Recruiter from "../models/Recruiter.js";
import Candidate from "../models/Candidate.js";
import Offer from "../models/Offer.js";
import Admin from "../models/Admin.js";
import Notification from "../models/Notification.js";
import Application from "../models/Application.js";
import Company from "../models/Company.js";
import bcrypt from "bcryptjs";
import SupportTicket from "../models/SupportTicket.js";
import AdminLog, { logAdminAction } from "../models/AdminLog.js";
import AnemRegistration from "../models/AnemRegistration.js";

export const getRecruiters = async (req, res) => {
  try {
    const { status, page = 1, limit = 20, search } = req.query;

    let query = {};

    if (status === "pending") {
      query.status = { $in: ["pending_validation", "pending_revalidation"] };
    } else if (status === "requests_sent") {
      query.status = {
        $in: [
          "pending_info",
          "pending_documents",
          "pending_info_and_documents",
        ],
      };
    } else if (status === "decision_made") {
      query.status = { $in: ["validated", "rejected"] };
    } else if (status) {
      query.status = status;
    }

    if (search) {
      const users = await User.find({
        $or: [
          { nom: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      }).select("_id");

      const userIds = users.map((u) => u._id);

      const companies = await Company.find({
        name: { $regex: search, $options: "i" },
      }).select("_id");
      const companyIds = companies.map((c) => c._id);

      query.$or = [
        { userId: { $in: userIds } },
        { companyId: { $in: companyIds } },
      ];
    }

    const skip = (page - 1) * limit;

    const recruiters = await Recruiter.find(query)
      .populate({
        path: "userId",
        select: "nom email createdAt",
      })
      .populate("companyId", "name status logo")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Recruiter.countDocuments(query);

    const enriched = recruiters
      .filter((r) => r.userId !== null)
      .map((r) => ({
        _id: r._id,
        userId: r.userId._id,
        nom: r.userId.nom,
        email: r.userId.email,
        createdAt: r.userId.createdAt,

        entrepriseId: r.companyId?._id,
        entreprise: r.companyId?.name || "Inconnue",
        entrepriseStatus: r.companyId?.status,
        entrepriseLogo: r.companyId?.logo,
        entrepriseDetails: r.companyId,

        position: r.position,
        telephone: r.telephone || "Non renseigné",
        recruiterStatus: r.status,
        isAdmin: r.isAdmin,
        rejectionReason: r.rejectionReason,

        anem: {
          status: r.anem?.status || "not_started",
          anemId: r.anem?.anemId,
          isRegistered: r.anem?.status === "registered",
        },

        validationRequests: r.validationRequests,

        lastRequestDate:
          r.validationRequests.length > 0
            ? r.validationRequests[r.validationRequests.length - 1].createdAt
            : null,
      }));

    res.json({
      data: enriched,
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

export const cancelValidationRequest = async (req, res) => {
  try {
    const { id } = req.params;

    const recruiter = await Recruiter.findById(id);
    if (!recruiter) {
      return res.status(404).json({ msg: "Recruteur introuvable" });
    }

    recruiter.status = "pending_validation";

    recruiter.validationRequests = recruiter.validationRequests.filter(
      (req) => req.status !== "pending",
    );

    await recruiter.save();

    await logAdminAction(
      req.user.id,
      "recruiter_request_canceled",
      { type: "recruiter", id: recruiter._id },
      {},
      req,
    );

    res.json({ msg: "Demande annulée, recruteur replacé en attente ✅" });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getCompanyDetailsAdmin = async (req, res) => {
  try {
    const { companyId } = req.params;
    const company = await Company.findById(companyId);

    if (!company)
      return res.status(404).json({ msg: "Entreprise introuvable" });

    const recruiterCount = await Recruiter.countDocuments({ companyId });
    const offerCount = await Offer.countDocuments({ companyId });

    res.json({
      ...company.toObject(),
      stats: {
        recruiters: recruiterCount,
        offers: offerCount,
      },
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const validateRecruiter = async (req, res) => {
  try {
    const { id } = req.params;

    let recruiter = await Recruiter.findById(id).populate("companyId");
    if (!recruiter) {
      recruiter = await Recruiter.findOne({ userId: id }).populate("companyId");
    }

    if (!recruiter) {
      return res.status(404).json({ msg: "Recruteur introuvable" });
    }

    const user = await User.findById(recruiter.userId);
    if (!user) {
      return res.status(404).json({ msg: "Utilisateur introuvable" });
    }

    recruiter.status = "validated";

    const existingAdmins = await Recruiter.countDocuments({
      companyId: recruiter.companyId._id,
      status: "validated",
      isAdmin: true,
    });

    if (existingAdmins === 0 && recruiter.companyId.status === "active") {
      recruiter.isAdmin = true;
      recruiter.permissions.editCompany = true;
      recruiter.permissions.manageTeam = true;

      await Notification.create({
        userId: user._id,
        message: `Félicitations ! Vous êtes le premier recruteur validé de "${recruiter.companyId.name}" et devenez automatiquement administrateur de l'entreprise.`,
        type: "validation",
      });
    }

    await recruiter.save();

    await Notification.create({
      userId: user._id,
      message:
        "Félicitations ! Votre compte recruteur a été validé. Vous pouvez maintenant publier des offres.",
      type: "validation",
    });

    await logAdminAction(
      req.user.id,
      "recruiter_validated",
      { type: "recruiter", id: recruiter._id },
      { isFirstAdmin: recruiter.isAdmin },
      req,
    );

    res.json({
      msg: "Recruteur validé avec succès ✅",
      isCompanyAdmin: recruiter.isAdmin,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const rejectRecruiter = async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;

    let recruiter = await Recruiter.findById(id);
    if (!recruiter) {
      recruiter = await Recruiter.findOne({ userId: id });
    }

    if (!recruiter) {
      return res.status(404).json({ msg: "Recruteur introuvable" });
    }

    recruiter.status = "rejected";
    recruiter.rejectionReason = message || "Non spécifiée";
    await recruiter.save();

    await Notification.create({
      userId: recruiter.userId,
      message: `Votre compte recruteur a été rejeté. Raison : ${
        message || "Non spécifiée"
      }`,
      type: "alerte",
    });

    await logAdminAction(
      req.user.id,
      "recruiter_rejected",
      { type: "recruiter", id: recruiter._id },
      { reason: message },
      req,
    );

    res.json({ msg: "Recruteur rejeté ❌" });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getAllAdmins = async (req, res) => {
  try {
    const admins = await Admin.find()
      .populate("userId", "nom email createdAt")
      .populate("createdBy", "nom")
      .sort({ createdAt: -1 });

    res.json(admins);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};
export const suspendAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, until } = req.body;

    if (id === req.user.id) {
      return res
        .status(400)
        .json({ msg: "Vous ne pouvez pas vous suspendre vous-même." });
    }

    const targetAdmin = await Admin.findOne({ userId: id });
    if (!targetAdmin) {
      return res.status(404).json({ msg: "Admin introuvable" });
    }

    if (targetAdmin.label === "super_admin") {
      return res
        .status(403)
        .json({ msg: "Impossible de suspendre un super admin" });
    }

    targetAdmin.status = "suspended";
    targetAdmin.suspensionReason = reason;
    targetAdmin.suspendedUntil = until ? new Date(until) : null;
    await targetAdmin.save();

    await logAdminAction(
      req.user.id,
      "admin_suspended",
      { type: "admin", id: targetAdmin._id },
      { reason, until },
      req,
    );

    res.json({ msg: "Administrateur suspendu ⛔" });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getPendingCompanies = async (req, res) => {
  try {
    const companies = await Company.find({ status: "pending" }).sort({
      createdAt: -1,
    });
    res.json(companies);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const validateCompany = async (req, res) => {
  try {
    const { id } = req.params;
    const company = await Company.findByIdAndUpdate(
      id,
      { status: "active" },
      { new: true },
    );

    if (!company)
      return res.status(404).json({ msg: "Entreprise introuvable" });

    res.json({ msg: "Entreprise validée avec succès ✅", company });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const rejectCompany = async (req, res) => {
  try {
    const { id } = req.params;
    const company = await Company.findByIdAndUpdate(
      id,
      { status: "rejected" },
      { new: true },
    );

    if (!company)
      return res.status(404).json({ msg: "Entreprise introuvable" });

    res.json({ msg: "Entreprise rejetée ❌", company });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const createAdmin = async (req, res) => {
  try {
    const { nom, email, motDePasse, forceVerify } = req.body;

    const exist = await User.findOne({ email });
    if (exist) return res.status(400).json({ msg: "Email déjà utilisé" });

    const hash = await bcrypt.hash(motDePasse, 10);

    const emailVerified = forceVerify !== undefined ? forceVerify : true;

    const user = await User.create({
      nom,
      email,
      motDePasse: hash,
      role: "admin",
      statutValidation: "validé",
      emailVerified: emailVerified,
    });

    await Admin.create({ userId: user._id });

    res.status(201).json({ msg: "Nouvel administrateur créé ✅", admin: user });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const deleteAdmin = async (req, res) => {
  try {
    const { id } = req.params;

    if (id === req.user.id)
      return res
        .status(400)
        .json({ msg: "Vous ne pouvez pas vous supprimer vous-même." });

    const adminUser = await User.findById(id);
    if (!adminUser || adminUser.role !== "admin")
      return res.status(404).json({ msg: "Admin introuvable" });

    await User.findByIdAndDelete(id);
    await Admin.findOneAndDelete({ userId: id });

    res.json({ msg: "Administrateur supprimé 🗑️" });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const banUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { raison } = req.body;

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ msg: "Utilisateur introuvable" });
    if (user.role === "admin")
      return res.status(403).json({ msg: "Impossible de bannir un admin." });

    user.accountStatus = "banned";
    user.suspensionReason = raison || "Non respect des conditions.";
    await user.save();

    await Notification.create({
      userId: user._id,
      message: `Votre compte a été désactivé. Raison : ${
        raison || "Non respect des conditions."
      }`,
      type: "alerte",
    });

    await logAdminAction(
      req.user.id,
      "user_banned",
      { type: "user", id: user._id },
      { reason: raison },
      req,
    );

    res.json({ msg: `Utilisateur ${user.nom} a été banni ⛔` });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const unBanUser = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ msg: "Utilisateur introuvable" });

    if (user.role === "admin") {
      return res.status(400).json({ msg: "Action inutile sur un admin." });
    }

    if (user.accountStatus === "active") {
      return res.status(400).json({ msg: "Cet utilisateur n'est pas banni." });
    }

    user.accountStatus = "active";
    user.suspensionReason = undefined;
    user.suspendedUntil = undefined;
    await user.save();

    await Notification.create({
      userId: user._id,
      message:
        "Bonne nouvelle ! Votre compte a été réactivé par l'administration. Vous pouvez à nouveau vous connecter.",
      type: "info",
    });

    await logAdminAction(
      req.user.id,
      "user_unbanned",
      { type: "user", id: user._id },
      {},
      req,
    );

    res.json({ msg: `L'utilisateur ${user.nom} a été débanni et réactivé ✅` });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getAllUsers = async (req, res) => {
  try {
    const {
      role,
      status,
      search,
      wilaya,
      proposable,
      emailVerified,
      page = 1,
      limit = 20,
    } = req.query;

    let query = {};
    if (role) query.role = role;
    if (status) query.accountStatus = status;
    if (emailVerified) query.emailVerified = emailVerified === "true";

    if (search) {
      query.$or = [
        { nom: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      User.find(query)
        .select("-motDePasse")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      User.countDocuments(query),
    ]);

    const userIds = users.map((u) => u._id);

    const [candidates, recruiters] = await Promise.all([
      Candidate.find({ userId: { $in: userIds } })
        .select(
          "userId telephone residence autoriserProposition desiredPosition",
        )
        .lean(),
      Recruiter.find({ userId: { $in: userIds } })
        .populate("companyId", "name")
        .select("userId status companyId")
        .lean(),
    ]);

    const candidateMap = new Map(
      candidates.map((c) => [c.userId.toString(), c]),
    );
    const recruiterMap = new Map(
      recruiters.map((r) => [r.userId.toString(), r]),
    );

    const recruiterIds = recruiters.map((r) => r._id);
    const offerCounts = await Offer.aggregate([
      { $match: { recruteurId: { $in: recruiterIds } } },
      { $group: { _id: "$recruteurId", count: { $sum: 1 } } },
    ]);

    const offerCountMap = new Map(
      offerCounts.map((o) => [o._id.toString(), o.count]),
    );

    let enriched = users.map((u) => {
      const userId = u._id.toString();
      let details = {};

      if (u.role === "candidat") {
        const cand = candidateMap.get(userId);
        if (cand) {
          details = {
            telephone: cand.telephone,
            wilaya: cand.residence?.wilaya || null,
            autoriserProposition: cand.autoriserProposition,
            poste: cand.desiredPosition,
          };
        }
      }

      if (u.role === "recruteur") {
        const rec = recruiterMap.get(userId);
        if (rec) {
          details = {
            entreprise: rec.companyId?.name || "Inconnue",
            recruiterStatus: rec.status,
            offres: offerCountMap.get(rec._id.toString()) || 0,
          };
        }
      }

      return {
        ...u,
        accountStatus: u.accountStatus,
        details,
      };
    });

    if (wilaya) {
      enriched = enriched.filter(
        (u) =>
          u.details?.wilaya &&
          u.details.wilaya.toLowerCase() === wilaya.toLowerCase(),
      );
    }

    if (proposable === "true") {
      enriched = enriched.filter(
        (u) => u.details?.autoriserProposition === true,
      );
    }

    res.json({
      data: enriched,
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

export const sendMessageToUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;

    await Notification.create({
      userId: id,
      message: `Message de l'administration : ${message}`,
      type: "info",
    });

    res.json({ msg: "Notification envoyée ✅" });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const deleteOfferAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { motif } = req.body;

    const offer = await Offer.findById(id).populate("recruteurId");
    if (!offer) return res.status(404).json({ msg: "Offre introuvable" });

    if (offer.recruteurId && offer.recruteurId.userId) {
      await Notification.create({
        userId: offer.recruteurId.userId,
        message: `Votre offre "${offer.titre}" a été supprimée. Motif : ${
          motif || "Non conforme"
        }`,
        type: "alerte",
      });
    }

    await Offer.findByIdAndDelete(id);

    res.json({ msg: "Offre supprimée et recruteur notifié 🗑️" });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getGlobalStats = async (req, res) => {
  try {
    const now = new Date();
    const fifteenMinutesAgo = new Date(now - 15 * 60 * 1000);
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

    const [
      onlineUsers,
      totalUsers,
      newUsersThisMonth,
      usersByRole,
      totalOffres,
      offresActives,
      pendingOffers,
      newOffersThisMonth,
      applicationStats,
      pendingRecruiters,
      pendingCompanies,
      openTickets,
      pendingAnem,
      recentAdminActions,
    ] = await Promise.all([
      User.countDocuments({ derniereConnexion: { $gt: fifteenMinutesAgo } }),
      User.countDocuments(),
      User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      User.aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }]),
      Offer.countDocuments(),
      Offer.countDocuments({ actif: true, validationStatus: "approved" }),
      Offer.countDocuments({ validationStatus: "pending" }),
      Offer.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      Application.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),

      Recruiter.countDocuments({
        status: { $in: ["pending_validation", "pending_revalidation"] },
      }),
      Company.countDocuments({ status: "pending" }),
      SupportTicket.countDocuments({
        status: { $in: ["open", "in_progress"] },
      }),
      AnemRegistration.countDocuments({
        status: { $in: ["pending", "pending_verification"] },
      }),
      AdminLog.find()
        .populate("adminId", "nom")
        .sort({ createdAt: -1 })
        .limit(10),
    ]);

    const roleMap = {};
    usersByRole.forEach((r) => {
      roleMap[r._id] = r.count;
    });

    const statsCandidatures = {};
    applicationStats.forEach((s) => {
      statsCandidatures[s._id] = s.count;
    });

    const pendingTasks = {
      recruiters: pendingRecruiters,
      companies: 0,
      offers: pendingOffers,
      tickets: openTickets,
      total: pendingRecruiters + pendingOffers + openTickets,
    };

    res.json({
      users: {
        online: onlineUsers,
        total: totalUsers,
        newThisMonth: newUsersThisMonth,
        byRole: roleMap,
      },
      offres: {
        total: totalOffres,
        actives: offresActives,
        pending: pendingOffers,
        newThisMonth: newOffersThisMonth,
      },
      candidatures: statsCandidatures,
      pendingTasks,
      recentAdminActions,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getTrends = async (req, res) => {
  try {
    const { period = "30" } = req.query;
    const days = parseInt(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const [rawUsers, rawOffers, rawApplications] = await Promise.all([
      User.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: {
              date: {
                $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
              },
            },
            count: { $sum: 1 },
          },
        },
      ]),

      Offer.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            count: { $sum: 1 },
          },
        },
      ]),

      Application.aggregate([
        { $match: { datePostulation: { $gte: startDate } } },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$datePostulation" },
            },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const statsMap = new Map();
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];

      statsMap.set(dateStr, {
        date: dateStr,
        users: 0,
        offers: 0,
        applications: 0,
      });
    }

    rawUsers.forEach((u) => {
      const date = u._id.date;
      if (statsMap.has(date)) {
        statsMap.get(date).users += u.count;
      }
    });

    rawOffers.forEach((o) => {
      const date = o._id;
      if (statsMap.has(date)) {
        statsMap.get(date).offers += o.count;
      }
    });

    rawApplications.forEach((a) => {
      const date = a._id;
      if (statsMap.has(date)) {
        statsMap.get(date).applications += a.count;
      }
    });

    const chartData = Array.from(statsMap.values()).sort(
      (a, b) => new Date(a.date) - new Date(b.date),
    );

    res.json({
      data: chartData,
      period: days,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getManualSelectionOffers = async (req, res) => {
  try {
    const {
      minProposals,
      maxProposals,
      startDate,
      endDate,
      sortBy = "datePublication",
    } = req.query;

    const pipeline = [
      {
        $match: {
          actif: true,
          candidateSearchMode: "manual",
          validationStatus: "approved",
        },
      },
    ];

    if (startDate || endDate) {
      const dateFilter = {};
      if (startDate) dateFilter.$gte = new Date(startDate);
      if (endDate) dateFilter.$lte = new Date(endDate);
      pipeline[0].$match.datePublication = dateFilter;
    }

    pipeline.push({
      $lookup: {
        from: "applications",
        let: { offerId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$offerId", "$$offerId"] },
                  { $eq: ["$recommandeParAdmin", true] },
                ],
              },
            },
          },
          { $count: "count" },
        ],
        as: "adminProposals",
      },
    });

    pipeline.push({
      $addFields: {
        proposalCount: {
          $ifNull: [{ $arrayElemAt: ["$adminProposals.count", 0] }, 0],
        },
      },
    });

    if (minProposals !== undefined || maxProposals !== undefined) {
      const countMatch = {};
      if (minProposals !== undefined) countMatch.$gte = parseInt(minProposals);
      if (maxProposals !== undefined) countMatch.$lte = parseInt(maxProposals);
      pipeline.push({ $match: { proposalCount: countMatch } });
    }

    pipeline.push(
      {
        $lookup: {
          from: "recruiters",
          localField: "recruteurId",
          foreignField: "_id",
          as: "recruteur",
        },
      },
      { $unwind: "$recruteur" },
      {
        $lookup: {
          from: "companies",
          localField: "companyId",
          foreignField: "_id",
          as: "company",
        },
      },
      { $unwind: "$company" },
    );

    let sortStage = {};
    if (sortBy === "lastModified") {
      sortStage = { updatedAt: -1 };
    } else {
      sortStage = { datePublication: -1 };
    }
    pipeline.push({ $sort: sortStage });

    const offers = await Offer.aggregate(pipeline);

    res.json(offers);
  } catch (err) {
    console.error("Erreur Manual Matching:", err);
    res.status(500).json({ msg: err.message });
  }
};

export const proposeCandidateToOffer = async (req, res) => {
  try {
    const { candidatId, offreId } = req.body;

    const offer = await Offer.findById(offreId).populate("recruteurId");
    if (!offer) {
      return res.status(404).json({ msg: "Offre introuvable" });
    }

    let candidate = await Candidate.findById(candidatId).populate("userId");

    if (!candidate) {
      candidate = await Candidate.findOne({ userId: candidatId }).populate(
        "userId",
      );
    }

    if (!candidate) {
      return res.status(404).json({ msg: "Candidat introuvable" });
    }

    if (!candidate.userId?.emailVerified) {
      return res.status(400).json({ msg: "Email candidat non vérifié." });
    }

    if (!candidate.autoriserProposition) {
      return res
        .status(403)
        .json({ msg: "Ce candidat refuse les propositions." });
    }

    if (!candidate.cvs || candidate.cvs.length === 0) {
      return res.status(400).json({
        msg: "Impossible de proposer ce candidat : il n'a pas de CV.",
      });
    }

    const existingApp = await Application.findOne({
      offerId: offreId,
      candidateId: candidate._id,
    });

    if (existingApp) {
      return res.status(400).json({ msg: "Candidat déjà positionné." });
    }
    const lastCv = candidate.cvs[candidate.cvs.length - 1].url;

    await Application.create({
      offerId: offreId,
      candidateId: candidate._id,
      cvUrl: lastCv,

      candidateStatus: "envoyee",
      recruiterStatus: "nouvelle",

      source: "admin_proposal",
      proposedBy: req.user.id,
      proposedAt: new Date(),

      coverLetter:
        "Recommandation Admin : Ce profil correspond parfaitement aux critères de l’offre.",

      offerSnapshot: {
        titre: offer.titre,
        companyId: offer.companyId,
        type: offer.type,
      },
    });

    offer.nombreCandidatures += 1;
    await offer.save();

    if (offer.recruteurId?.userId) {
      await Notification.create({
        userId: offer.recruteurId.userId,
        message: `Un administrateur vous a proposé un candidat recommandé (${candidate.userId.nom}) pour votre offre "${offer.titre}".`,
        type: "validation",
      });
    }

    await Notification.create({
      userId: candidate.userId._id,
      message: `Bonne nouvelle ! Votre profil a été recommandé par un administrateur pour l'offre "${offer.titre}".`,
      type: "info",
    });

    return res.json({ msg: "Candidat proposé avec succès ✅" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ msg: err.message });
  }
};

export const getAdminLogs = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      adminId,
      action,
      startDate,
      endDate,
    } = req.query;

    let query = {};
    if (adminId) query.adminId = adminId;
    if (action) query.action = action;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const logs = await AdminLog.find(query)
      .populate("adminId", "nom email")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await AdminLog.countDocuments(query);

    res.json({
      data: logs,
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

export const getPendingOffers = async (req, res) => {
  try {
    const { page = 1, limit = 20, sortBy = "createdAt" } = req.query;

    const offers = await Offer.find({ validationStatus: "pending" })
      .populate("companyId", "name logo")
      .populate({
        path: "recruteurId",
        select: "userId position",
        populate: { path: "userId", select: "nom email" },
      })
      .sort({ [sortBy]: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Offer.countDocuments({ validationStatus: "pending" });

    res.json({
      data: offers,
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

export const approveOffer = async (req, res) => {
  try {
    const { id } = req.params;

    const offer = await Offer.findById(id).populate("recruteurId");
    if (!offer) return res.status(404).json({ msg: "Offre introuvable." });

    offer.validationStatus = "approved";
    offer.actif = true;
    offer.datePublication = new Date();
    offer.validationHistory.push({
      status: "approved",
      adminId: req.user.id,
    });
    await offer.save();

    if (offer.recruteurId && offer.recruteurId.userId) {
      await Notification.create({
        userId: offer.recruteurId.userId,
        message: `Votre offre "${offer.titre}" a été approuvée et est maintenant visible.`,
        type: "validation",
      });
    }

    await logAdminAction(
      req.user.id,
      "offer_approved",
      { type: "offer", id: offer._id },
      {},
      req,
    );

    res.json({ msg: "Offre approuvée ✅", offer });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const rejectOffer = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, requestChanges } = req.body;

    const offer = await Offer.findById(id).populate("recruteurId");
    if (!offer) return res.status(404).json({ msg: "Offre introuvable." });

    offer.validationStatus = requestChanges ? "changes_requested" : "rejected";
    offer.rejectionReason = reason;
    offer.validationHistory.push({
      status: offer.validationStatus,
      message: reason,
      adminId: req.user.id,
    });
    await offer.save();

    const msgType = requestChanges
      ? `Des modifications sont demandées pour votre offre "${offer.titre}": ${reason}`
      : `Votre offre "${offer.titre}" a été refusée: ${reason}`;

    if (offer.recruteurId && offer.recruteurId.userId) {
      await Notification.create({
        userId: offer.recruteurId.userId,
        message: msgType,
        type: "alerte",
      });
    }

    await logAdminAction(
      req.user.id,
      requestChanges ? "offer_changes_requested" : "offer_rejected",
      { type: "offer", id: offer._id },
      { reason },
      req,
    );

    res.json({
      msg: requestChanges ? "Modifications demandées." : "Offre refusée.",
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const requestRecruiterDocuments = async (req, res) => {
  try {
    const { recruiterId } = req.params;
    const { type, message, requiredDocuments, requiredFields } = req.body;

    const recruiter = await Recruiter.findById(recruiterId).populate("userId");
    if (!recruiter) {
      return res.status(404).json({ msg: "Recruteur introuvable." });
    }

    recruiter.status =
      type === "document" ? "pending_documents" : "pending_info";
    recruiter.validationRequests.push({
      type,
      message,
      requiredDocuments,
      requiredFields,
      status: "pending",
    });
    await recruiter.save();

    await Notification.create({
      userId: recruiter.userId._id,
      message: `Action requise : ${message}`,
      type: "alerte",
    });

    await logAdminAction(
      req.user.id,
      "recruiter_documents_requested",
      { type: "recruiter", id: recruiter._id },
      { requestType: type, message },
      req,
    );

    res.json({ msg: "Demande envoyée au recruteur ✅" });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const updateAdminPermissions = async (req, res) => {
  try {
    const { id } = req.params;
    const { permissions } = req.body;

    const targetAdmin = await Admin.findOne({ userId: id });
    if (!targetAdmin) {
      return res.status(404).json({ msg: "Admin introuvable" });
    }

    if (targetAdmin.label === "super_admin") {
      return res.status(403).json({
        msg: "Impossible de modifier les permissions d'un super admin",
      });
    }

    targetAdmin.permissions = { ...targetAdmin.permissions, ...permissions };
    await targetAdmin.save();

    await logAdminAction(
      req.user.id,
      "admin_permissions_updated",
      { type: "admin", id: targetAdmin._id },
      { newPermissions: permissions },
      req,
    );

    res.json({ msg: "Permissions mises à jour ✅", admin: targetAdmin });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const updateAdminLabel = async (req, res) => {
  try {
    const { id } = req.params;
    const { label } = req.body;

    const validLabels = [
      "super_admin",
      "support",
      "technical",
      "operational",
      "recruitment",
      "moderation",
      "product",
    ];

    if (!validLabels.includes(label)) {
      return res.status(400).json({ msg: "Label invalide" });
    }

    const targetAdmin = await Admin.findOne({ userId: id });
    if (!targetAdmin) {
      return res.status(404).json({ msg: "Admin introuvable" });
    }

    const oldLabel = targetAdmin.label;
    targetAdmin.label = label;
    await targetAdmin.save();

    await logAdminAction(
      req.user.id,
      "admin_label_changed",
      { type: "admin", id: targetAdmin._id },
      { oldLabel, newLabel: label },
      req,
    );

    res.json({ msg: "Label mis à jour ✅", admin: targetAdmin });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const createCompanyByAdmin = async (req, res) => {
  try {
    const { name, website, description, industry, location, size, logo } =
      req.body;

    if (!name) {
      return res
        .status(400)
        .json({ msg: "Le nom de l'entreprise est obligatoire." });
    }

    const existingCompany = await Company.findOne({
      name: { $regex: new RegExp(`^${name}$`, "i") },
    });

    if (existingCompany) {
      return res
        .status(400)
        .json({ msg: "Une entreprise avec ce nom existe déjà." });
    }

    const company = await Company.create({
      name,
      website,
      description,
      industry,
      location,
      size,
      logo,
      status: "active",
    });

    await logAdminAction(
      req.user.id,
      "company_created_by_admin",
      { type: "company", id: company._id },
      { name },
      req,
    );

    res.status(201).json({
      msg: "Entreprise créée avec succès ✅",
      company,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getCompanyRecruiters = async (req, res) => {
  try {
    const { companyId } = req.params;

    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(404).json({ msg: "Entreprise introuvable." });
    }

    const recruiters = await Recruiter.find({ companyId })
      .populate("userId", "nom email createdAt")
      .sort({ isAdmin: -1, createdAt: 1 });

    res.json({
      company: {
        _id: company._id,
        name: company.name,
        status: company.status,
      },
      recruiters,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const assignCompanyAdmin = async (req, res) => {
  try {
    const { companyId, recruiterId } = req.body;

    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(404).json({ msg: "Entreprise introuvable." });
    }

    const recruiter = await Recruiter.findById(recruiterId).populate("userId");
    if (!recruiter) {
      return res.status(404).json({ msg: "Recruteur introuvable." });
    }

    if (recruiter.companyId.toString() !== companyId) {
      return res.status(400).json({
        msg: "Ce recruteur n'appartient pas à cette entreprise.",
      });
    }

    if (recruiter.status !== "validated") {
      return res.status(400).json({
        msg: "Le recruteur doit être validé avant de devenir administrateur.",
      });
    }

    recruiter.isAdmin = true;
    recruiter.permissions.editCompany = true;
    recruiter.permissions.manageTeam = true;
    await recruiter.save();

    await Notification.create({
      userId: recruiter.userId._id,
      message: `Vous êtes maintenant administrateur de l'entreprise "${company.name}".`,
      type: "validation",
    });

    await logAdminAction(
      req.user.id,
      "company_admin_assigned",
      { type: "recruiter", id: recruiter._id },
      { companyId, companyName: company.name },
      req,
    );

    res.json({
      msg: `${recruiter.userId.nom} est maintenant administrateur de ${company.name} ✅`,
      recruiter,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const removeCompanyAdmin = async (req, res) => {
  try {
    const { recruiterId } = req.params;

    const recruiter = await Recruiter.findById(recruiterId)
      .populate("userId")
      .populate("companyId");

    if (!recruiter) {
      return res.status(404).json({ msg: "Recruteur introuvable." });
    }

    if (!recruiter.isAdmin) {
      return res.status(400).json({
        msg: "Ce recruteur n'est pas administrateur d'entreprise.",
      });
    }

    recruiter.isAdmin = false;
    recruiter.permissions.editCompany = false;
    recruiter.permissions.manageTeam = false;
    await recruiter.save();

    await Notification.create({
      userId: recruiter.userId._id,
      message: `Vous n'êtes plus administrateur de l'entreprise "${recruiter.companyId.name}".`,
      type: "info",
    });

    await logAdminAction(
      req.user.id,
      "company_admin_removed",
      { type: "recruiter", id: recruiter._id },
      {
        companyId: recruiter.companyId._id,
        companyName: recruiter.companyId.name,
      },
      req,
    );

    res.json({
      msg: `${recruiter.userId.nom} n'est plus administrateur ⚠️`,
      recruiter,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const updateCompanyByAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, website, description, industry, location, size, logo } =
      req.body;

    const company = await Company.findByIdAndUpdate(
      id,
      { name, website, description, industry, location, size, logo },
      { new: true },
    );

    if (!company) {
      return res.status(404).json({ msg: "Entreprise introuvable." });
    }

    await logAdminAction(
      req.user.id,
      "company_updated_by_admin",
      { type: "company", id: company._id },
      { updates: req.body },
      req,
    );

    res.json({ msg: "Entreprise mise à jour ✅", company });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const requestMultipleValidationItems = async (req, res) => {
  try {
    const { recruiterId } = req.params;
    const { requests } = req.body;

    const recruiter = await Recruiter.findById(recruiterId).populate("userId");
    if (!recruiter) {
      return res.status(404).json({ msg: "Recruteur introuvable." });
    }

    requests.forEach((request) => {
      recruiter.validationRequests.push({
        type: request.type,
        message: request.message,
        requiredDocuments: request.requiredDocuments || 0,
        requiredFields: request.requiredFields || [],
        status: "pending",
      });
    });

    const hasDocRequest = requests.some((r) => r.type === "document");
    const hasInfoRequest = requests.some((r) => r.type === "information");

    if (hasDocRequest && hasInfoRequest) {
      recruiter.status = "pending_info_and_documents";
    } else if (hasDocRequest) {
      recruiter.status = "pending_documents";
    } else if (hasInfoRequest) {
      recruiter.status = "pending_info";
    } else {
      return res.status(400).json({ msg: "Aucune demande valide reçue." });
    }

    await recruiter.save();

    await Notification.create({
      userId: recruiter.userId._id,
      message: `Action requise : Des informations ou documents vous sont demandés.`,
      type: "alerte",
    });

    await logAdminAction(
      req.user.id,
      "recruiter_multiple_requests",
      { type: "recruiter", id: recruiter._id },
      { requestCount: requests.length, newStatus: recruiter.status },
      req,
    );

    res.json({
      msg: `Demandes envoyées. Statut mis à jour vers : ${recruiter.status} ✅`,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getAllCompanies = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, status } = req.query;

    let query = {};

    if (status) {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { industry: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (page - 1) * limit;

    const companies = await Company.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Company.countDocuments(query);

    const enrichedCompanies = await Promise.all(
      companies.map(async (company) => {
        const recruitersCount = await Recruiter.countDocuments({
          companyId: company._id,
        });
        return {
          ...company.toObject(),
          recruitersCount,
        };
      }),
    );

    res.json({
      data: enrichedCompanies,
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
export const getOfferDetailsAdmin = async (req, res) => {
  try {
    const { id } = req.params;

    const offer = await Offer.findById(id)
      .populate("companyId", "name logo status website location")
      .populate({
        path: "recruteurId",
        select: "userId position status telephone",
        populate: { path: "userId", select: "nom email" },
      });

    if (!offer) return res.status(404).json({ msg: "Offre introuvable." });

    res.json(offer);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};
export const updateOfferByAdmin = async (req, res) => {
  try {
    const { id } = req.params;

    const offer = await Offer.findByIdAndUpdate(
      id,
      { $set: req.body },
      { new: true },
    );

    if (!offer) return res.status(404).json({ msg: "Offre introuvable" });

    await logAdminAction(
      req.user.id,
      "offer_updated_by_admin",
      { type: "offer", id: offer._id },
      { updates: req.body },
      req,
    );

    res.json({ msg: "Offre modifiée par l'admin ✅", offer });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};
export const toggleOfferVisibility = async (req, res) => {
  try {
    const { id } = req.params;
    const { actif } = req.body;

    const offer = await Offer.findByIdAndUpdate(
      id,
      { actif: actif },
      { new: true },
    );

    if (!offer) return res.status(404).json({ msg: "Offre introuvable" });

    await logAdminAction(
      req.user.id,
      actif ? "offer_activated_admin" : "offer_deactivated_admin",
      { type: "offer", id: offer._id },
      {},
      req,
    );

    res.json({
      msg: `Offre ${actif ? "activée" : "désactivée"} avec succès`,
      offer,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getCandidateDetailsAdmin = async (req, res) => {
  const candidate = await Candidate.findById(req.params.id).populate("userId");
  res.json(candidate);
};
