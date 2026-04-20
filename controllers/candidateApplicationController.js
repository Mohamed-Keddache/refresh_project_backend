import Application from "../models/Application.js";
import Interview from "../models/Interview.js";
import Conversation from "../models/Conversation.js";
import Candidate from "../models/Candidate.js";
import Notification from "../models/Notification.js";
import Offer from "../models/Offer.js";

// ══════════════════════════════════════════════════════════════
// FEATURE 2.4: Ajout du paramètre `search` pour filtrer les candidatures
// ══════════════════════════════════════════════════════════════
export const getMyApplications = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    if (!candidate) {
      return res.status(404).json({ msg: "Profil introuvable" });
    }

    const { status, search, page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    let query = { candidateId: candidate._id };

    if (status && status !== "all") {
      query.candidateStatus = status;
    }

    // FEATURE 2.4: Recherche dans les candidatures par titre d'offre ou nom d'entreprise
    if (search && search.trim().length > 0) {
      const searchRegex = { $regex: search.trim(), $options: "i" };
      query.$or = [
        { "offerSnapshot.titre": searchRegex },
        { "offerSnapshot.entrepriseNom": searchRegex },
      ];
    }

    const [applications, total] = await Promise.all([
      Application.find(query)
        .sort({ datePostulation: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate({
          path: "offerId",
          select: "titre actif companyId type wilaya",
          populate: { path: "companyId", select: "name logo" },
        })
        .lean(),
      Application.countDocuments(query),
    ]);

    const appIds = applications.map((app) => app._id);

    const [conversations, upcomingInterviews, interviewCounts] =
      await Promise.all([
        Conversation.find({ applicationId: { $in: appIds } })
          .select("applicationId unreadByCandidate lastMessageAt status")
          .lean(),
        Interview.find({
          applicationId: { $in: appIds },
          status: {
            $in: ["proposed", "confirmed", "rescheduled_by_recruiter"],
          },
          scheduledAt: { $gte: new Date() },
        })
          .sort({ scheduledAt: 1 })
          .lean(),
        Interview.aggregate([
          { $match: { applicationId: { $in: appIds } } },
          { $group: { _id: "$applicationId", count: { $sum: 1 } } },
        ]),
      ]);

    const convMap = new Map(
      conversations.map((c) => [c.applicationId.toString(), c]),
    );

    const interviewMap = new Map();
    for (const interview of upcomingInterviews) {
      const appIdStr = interview.applicationId.toString();
      if (!interviewMap.has(appIdStr)) {
        interviewMap.set(appIdStr, interview);
      }
    }

    const countMap = new Map(
      interviewCounts.map((ic) => [ic._id.toString(), ic.count]),
    );

    const enriched = applications.map((app) => {
      const appIdStr = app._id.toString();
      const conversation = convMap.get(appIdStr);
      const upcomingInterview = interviewMap.get(appIdStr);
      const interviewCount = countMap.get(appIdStr) || 0;

      return {
        _id: app._id,
        status: app.candidateStatus,
        source: app.source,
        datePostulation: app.datePostulation,
        offer: app.offerId
          ? {
              _id: app.offerId._id,
              titre: app.offerId.titre,
              entreprise: app.offerId.companyId?.name,
              logo: app.offerId.companyId?.logo,
              type: app.offerId.type,
              wilaya: app.offerId.wilaya,
              actif: app.offerId.actif,
            }
          : {
              titre: app.offerSnapshot?.titre,
              entreprise: app.offerSnapshot?.entrepriseNom,
              actif: false,
              deleted: true,
            },
        hasConversation: !!conversation,
        conversationId: conversation?._id || null,
        unreadMessages: conversation?.unreadByCandidate || 0,
        upcomingInterview: upcomingInterview
          ? {
              _id: upcomingInterview._id,
              scheduledAt: upcomingInterview.scheduledAt,
              type: upcomingInterview.type,
              status: upcomingInterview.status,
              needsResponse: upcomingInterview.status === "proposed",
            }
          : null,
        totalInterviews: interviewCount,
      };
    });

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

export const getApplicationDetail = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    const { applicationId } = req.params;

    const application = await Application.findOne({
      _id: applicationId,
      candidateId: candidate._id,
    })
      .populate({
        path: "offerId",
        select:
          "titre description type wilaya companyId requirements salaryMin salaryMax",
        populate: {
          path: "companyId",
          select: "name logo website location size description",
        },
      })
      .lean();

    if (!application) {
      return res.status(404).json({ msg: "Candidature introuvable" });
    }

    const [conversation, interviews] = await Promise.all([
      Conversation.findOne({ applicationId })
        .select("_id messages unreadByCandidate status lastMessageAt")
        .lean(),
      Interview.find({ applicationId }).sort({ scheduledAt: -1 }).lean(),
    ]);

    res.json({
      application: {
        _id: application._id,
        status: application.candidateStatus,
        recruiterStatus: application.recruiterStatus,
        source: application.source,
        cvUrl: application.cvUrl,
        coverLetter: application.coverLetter,
        datePostulation: application.datePostulation,
        dateDecision: application.dateDecision,
        rejectionMessage: application.rejectionMessage || null,
      },

      offer: application.offerId || application.offerSnapshot,

      conversation: conversation
        ? {
            exists: true,
            _id: conversation._id,
            unreadCount: conversation.unreadByCandidate,
            messageCount: conversation.messages?.length || 0,
            status: conversation.status,
            lastMessageAt: conversation.lastMessageAt,
          }
        : { exists: false },

      interviews: interviews.map((i) => ({
        _id: i._id,
        type: i.type,
        scheduledAt: i.scheduledAt,
        duration: i.duration,
        location: i.location,
        meetingLink: i.meetingLink,
        status: i.status,
        proposedAlternative: i.proposedAlternative,
        preparationNotes: i.preparationNotes,
        canAccept:
          i.status === "proposed" || i.status === "rescheduled_by_recruiter",
        canCounter:
          i.status === "proposed" || i.status === "rescheduled_by_recruiter",
      })),

      statusHistory: application.statusHistory?.map((h) => ({
        status: h.candidateStatus,
        date: h.changedAt,
        note: h.note,
      })),
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// ══════════════════════════════════════════════════════════════
// BUG 3 FIX: Ajout des événements Socket.IO lors du retrait
// ══════════════════════════════════════════════════════════════
export const withdrawApplication = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    const { applicationId } = req.params;
    const { reason } = req.body;

    const application = await Application.findOne({
      _id: applicationId,
      candidateId: candidate._id,
    });

    if (!application)
      return res.status(404).json({ msg: "Candidature introuvable" });

    const terminalStatuses = [
      "retiree",
      "cancelled",
      "non_retenue",
      "embauchee",
    ];
    if (terminalStatuses.includes(application.candidateStatus)) {
      if (application.candidateStatus === "embauchee") {
        return res.status(400).json({
          msg: "Vous êtes embauché(e) sur cette offre. Utilisez la fonctionnalité dédiée si vous souhaitez quitter.",
          code: "ALREADY_HIRED",
        });
      }
      return res
        .status(400)
        .json({ msg: "Action impossible pour le statut actuel." });
    }

    if (application.candidateStatus === "retenue") {
      return res.status(400).json({
        msg: "Vous avez une offre d'embauche en attente. Veuillez la décliner avant de retirer votre candidature.",
        code: "HAS_PENDING_HIRE_OFFER",
        applicationId: application._id,
      });
    }

    application.candidateStatus = "retiree";
    application.recruiterStatus = "retiree_par_candidat";
    application.withdrawnAt = new Date();
    application.withdrawReason = reason;

    application.statusHistory.push({
      candidateStatus: "retiree",
      recruiterStatus: "retiree_par_candidat",
      changedBy: req.user.id,
      note: "Retrait volontaire par le candidat",
    });

    await application.save();

    await Interview.updateMany(
      {
        applicationId,
        status: {
          $in: [
            "proposed",
            "confirmed",
            "rescheduled_by_candidate",
            "rescheduled_by_recruiter",
          ],
        },
      },
      {
        status: "cancelled_by_candidate",
        cancellationReason: "Candidature retirée",
        cancelledBy: "candidate",
        cancelledAt: new Date(),
      },
    );

    const conversation = await Conversation.findOne({ applicationId });
    if (conversation && !conversation.isClosed) {
      conversation.messages.push({
        senderId: req.user.id,
        senderType: "system",
        content: "Le candidat a retiré sa candidature.",
        messageType: "system",
      });
      conversation.isClosed = true;
      conversation.closedReason = "application_closed";
      conversation.unreadByRecruiter += 1;
      conversation.lastMessageAt = new Date();
      await conversation.save();

      // ── BUG 3 FIX: Émettre les événements Socket.IO ──
      try {
        const { emitConversationClosed, emitNewMessage } =
          await import("../services/socketEvents.js");
        const lastMsg = conversation.messages[conversation.messages.length - 1];
        emitNewMessage(conversation._id.toString(), lastMsg);
        emitConversationClosed(conversation._id.toString(), {
          isClosed: true,
          closedBy: "candidate",
          reason: "application_withdrawn",
        });
      } catch (socketErr) {
        console.error("Socket emit failed (non-blocking):", socketErr.message);
      }
    }

    await Offer.findOneAndUpdate(
      { _id: application.offerId, nombreCandidatures: { $gt: 0 } },
      { $inc: { nombreCandidatures: -1 } },
    );

    const offer = await Offer.findById(application.offerId).populate(
      "recruteurId",
    );
    if (offer?.recruteurId?.userId) {
      await Notification.create({
        userId: offer.recruteurId.userId,
        message: `Le candidat a retiré sa candidature pour "${offer.titre}"`,
        type: "info",
      });
    }

    res.json({ msg: "Candidature retirée avec succès" });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const cancelApplication = async (req, res) => {
  const mongoose = (await import("mongoose")).default;
  const session = await mongoose.startSession();

  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    const { applicationId } = req.params;

    await session.withTransaction(async () => {
      const application = await Application.findOneAndUpdate(
        {
          _id: applicationId,
          candidateId: candidate._id,
          candidateStatus: "envoyee",
          seenByRecruiter: false,
          recruiterStatus: "nouvelle",
        },
        {
          $set: {
            candidateStatus: "cancelled",
            recruiterStatus: "annulee_par_candidat",
          },
          $push: {
            statusHistory: {
              candidateStatus: "cancelled",
              recruiterStatus: "annulee_par_candidat",
              changedBy: req.user.id,
              changedAt: new Date(),
              note: "Annulation par le candidat (avant lecture)",
            },
          },
        },
        { new: true, session },
      );

      if (!application) {
        const existing = await Application.findOne({
          _id: applicationId,
          candidateId: candidate._id,
        }).session(session);

        if (!existing) {
          throw { status: 404, msg: "Candidature introuvable" };
        }

        if (existing.seenByRecruiter) {
          throw {
            status: 403,
            msg: "Trop tard pour annuler. Le recruteur a déjà consulté votre candidature. Utilisez l'option 'Retirer' si disponible.",
          };
        }

        throw {
          status: 400,
          msg: "Impossible d'annuler cette candidature dans son état actuel.",
        };
      }

      await Offer.findOneAndUpdate(
        { _id: application.offerId, nombreCandidatures: { $gt: 0 } },
        { $inc: { nombreCandidatures: -1 } },
        { session },
      );
    });

    res.json({ msg: "Candidature annulée." });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ msg: err.msg });
    }
    res.status(500).json({ msg: err.message });
  } finally {
    await session.endSession();
  }
};

export const checkApplicationStatus = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    if (!candidate) return res.status(404).json({ msg: "Profil introuvable" });

    const { offerId } = req.params;

    const application = await Application.findOne({
      offerId: offerId,
      candidateId: candidate._id,
    }).populate("offerId", "allowRepostulation");

    if (!application) {
      return res.json({
        hasApplied: false,
        status: null,
        canCancel: false,
        canWithdraw: false,
        canRepostulate: false,
        action: "apply",
      });
    }

    const { candidateStatus, seenByRecruiter, recruiterStatus } = application;

    let canCancel = false;
    let canWithdraw = false;
    let canRepostulate = false;
    let action = "none";

    if (
      candidateStatus === "envoyee" &&
      !seenByRecruiter &&
      recruiterStatus === "nouvelle"
    ) {
      canCancel = true;
      action = "cancel";
    }

    const isEnCours =
      ["en_cours"].includes(candidateStatus) ||
      (candidateStatus === "envoyee" && seenByRecruiter);
    if (isEnCours) {
      canWithdraw = true;
      action = "withdraw";
    }

    if (["retiree", "cancelled"].includes(candidateStatus)) {
      const allowRepost = application.offerId?.allowRepostulation;

      if (allowRepost !== false) {
        canRepostulate = true;
        action = candidateStatus === "cancelled" ? "apply" : "repostulate";
      } else {
        action = "disabled";
      }
    }

    if (["retenue", "non_retenue"].includes(candidateStatus)) {
      action = "finished";
    }

    res.json({
      hasApplied: true,
      applicationId: application._id,
      status: candidateStatus,
      recruiterStatus: recruiterStatus,
      seenByRecruiter: seenByRecruiter,
      canCancel,
      canWithdraw,
      canRepostulate,
      action,
      allowRepostulation: application.offerId.allowRepostulation,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};
