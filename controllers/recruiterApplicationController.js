import Application from "../models/Application.js";
import Interview from "../models/Interview.js";
import Conversation from "../models/Conversation.js";
import Offer from "../models/Offer.js";
import Candidate from "../models/Candidate.js";
import Recruiter from "../models/Recruiter.js";
import Notification from "../models/Notification.js";
import {
  mapRecruiterToCandidate,
  NOTIFY_CANDIDATE_STATUSES,
} from "../utils/statusMapping.js";

const getRecruiterProfile = async (userId) => {
  const recruiter = await Recruiter.findOne({ userId }).populate("companyId");
  if (!recruiter) throw new Error("Profil recruteur non trouvé");
  return recruiter;
};

// FIX #9: Batch fetch instead of N+1 queries
export const getOfferApplications = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);
    const { offerId } = req.params;
    const {
      status,
      starred,
      search,
      page = 1,
      limit = 20,
      sortBy = "datePostulation",
      sortOrder = "desc",
    } = req.query;

    const offer = await Offer.findOne({
      _id: offerId,
      recruteurId: recruiter._id,
    });

    if (!offer) {
      return res.status(404).json({ msg: "Offre introuvable" });
    }

    let query = { offerId };

    if (status && status !== "all") {
      query.recruiterStatus = status;
    }

    if (starred === "true") {
      query.isStarred = true;
    }

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

    const [applications, total, statusCounts] = await Promise.all([
      Application.find(query)
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .populate({
          path: "candidateId",
          select: "profilePicture residence skills experiences userId",
          populate: { path: "userId", select: "nom email" },
        })
        .lean(),
      Application.countDocuments(query),
      Application.aggregate([
        { $match: { offerId: offer._id } },
        { $group: { _id: "$recruiterStatus", count: { $sum: 1 } } },
      ]),
    ]);

    // FIX #9: Batch fetch conversations and interviews (3 queries instead of 2N)
    const appIds = applications
      .filter((app) => app.candidateId !== null)
      .map((app) => app._id);

    const [conversations, upcomingInterviews] = await Promise.all([
      Conversation.find({ applicationId: { $in: appIds } })
        .select("applicationId unreadByRecruiter lastMessageAt")
        .lean(),
      Interview.find({
        applicationId: { $in: appIds },
        status: {
          $in: ["proposed", "confirmed", "rescheduled_by_candidate"],
        },
        scheduledAt: { $gte: new Date() },
      })
        .sort({ scheduledAt: 1 })
        .lean(),
    ]);

    // Build maps
    const convMap = new Map(
      conversations.map((c) => [c.applicationId.toString(), c]),
    );
    const interviewMap = new Map();
    for (const interview of upcomingInterviews) {
      const key = interview.applicationId.toString();
      if (!interviewMap.has(key)) {
        interviewMap.set(key, interview);
      }
    }

    const enriched = applications
      .filter((app) => app.candidateId !== null)
      .map((app) => {
        const appIdStr = app._id.toString();
        const conversation = convMap.get(appIdStr);
        const upcomingInterview = interviewMap.get(appIdStr);

        return {
          _id: app._id,
          status: app.recruiterStatus,
          candidateStatus: app.candidateStatus,
          source: app.source,
          isStarred: app.isStarred,
          seenByRecruiter: app.seenByRecruiter,
          datePostulation: app.datePostulation,
          recruiterNotes: app.recruiterNotes,
          candidate: {
            _id: app.candidateId._id,
            nom: app.candidateId.userId?.nom,
            email: app.candidateId.userId?.email,
            profilePicture: app.candidateId.profilePicture,
            residence: app.candidateId.residence,
            skillsCount: app.candidateId.skills?.length || 0,
            experiencesCount: app.candidateId.experiences?.length || 0,
          },
          cvUrl: app.cvUrl,
          hasConversation: !!conversation,
          conversationId: conversation?._id || null,
          unreadMessages: conversation?.unreadByRecruiter || 0,
          upcomingInterview: upcomingInterview
            ? {
                _id: upcomingInterview._id,
                scheduledAt: upcomingInterview.scheduledAt,
                status: upcomingInterview.status,
                needsAction:
                  upcomingInterview.status === "rescheduled_by_candidate",
              }
            : null,
        };
      });

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

export const markAsSeen = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);
    const { applicationId } = req.params;

    const application =
      await Application.findById(applicationId).populate("offerId");

    if (!application) {
      return res.status(404).json({ msg: "Candidature introuvable" });
    }

    if (
      application.offerId.recruteurId.toString() !== recruiter._id.toString()
    ) {
      return res.status(403).json({ msg: "Non autorisé" });
    }

    if (!application.seenByRecruiter) {
      application.seenByRecruiter = true;
      application.seenAt = new Date();

      if (application.recruiterStatus === "nouvelle") {
        application.recruiterStatus = "consultee";
        application.candidateStatus = mapRecruiterToCandidate("consultee");
        application.statusHistory.push({
          candidateStatus: application.candidateStatus,
          recruiterStatus: "consultee",
          changedBy: req.user.id,
        });
      }

      await application.save();
    }

    res.json({ msg: "Marquée comme vue", application });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// FIX #13: Accept rejectionMessage when rejecting
export const updateRecruiterStatus = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);
    const { applicationId } = req.params;
    const { status, notes, rejectionMessage } = req.body;

    const application =
      await Application.findById(applicationId).populate("offerId");

    if (!application) {
      return res.status(404).json({ msg: "Candidature introuvable" });
    }

    if (
      application.offerId.recruteurId.toString() !== recruiter._id.toString()
    ) {
      return res.status(403).json({ msg: "Non autorisé" });
    }

    const validTransitions = {
      nouvelle: ["consultee", "preselection", "refusee"],
      consultee: ["preselection", "en_discussion", "refusee"],
      preselection: ["en_discussion", "entretien_planifie", "refusee"],
      en_discussion: ["preselection", "entretien_planifie", "refusee"],
      entretien_planifie: ["entretien_termine", "refusee"],
      entretien_termine: ["retenue", "refusee", "entretien_planifie"],
    };

    const allowed = validTransitions[application.recruiterStatus] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({
        msg: `Transition non autorisée de "${application.recruiterStatus}" vers "${status}"`,
      });
    }

    const previousRecruiterStatus = application.recruiterStatus;
    application.recruiterStatus = status;
    application.candidateStatus = mapRecruiterToCandidate(status);

    if (notes) {
      application.recruiterNotes = notes;
    }

    if (status === "retenue" || status === "refusee") {
      application.dateDecision = new Date();
    }

    // Stocker le message de rejet
    if (status === "refusee" && rejectionMessage) {
      application.rejectionMessage = rejectionMessage;
    }

    application.statusHistory.push({
      candidateStatus: application.candidateStatus,
      recruiterStatus: status,
      changedBy: req.user.id,
      note: notes,
    });

    await application.save();

    // ▶ FIX: Si refusée, envoyer le message dans la conversation
    if (status === "refusee") {
      const conversation = await Conversation.findOne({ applicationId });
      if (conversation) {
        const rejectContent = rejectionMessage
          ? `Votre candidature pour "${application.offerId.titre}" n'a pas été retenue.\n\nMessage du recruteur : ${rejectionMessage}`
          : `Votre candidature pour "${application.offerId.titre}" n'a pas été retenue.`;

        conversation.messages.push({
          senderId: req.user.id,
          senderType: "system",
          content: rejectContent,
          messageType: "rejection",
        });
        conversation.isClosed = true;
        conversation.closedReason = "application_rejected";
        conversation.unreadByCandidate += 1;
        conversation.lastMessageAt = new Date();
        await conversation.save();

        // Émettre via socket
        const { emitNewMessage, emitConversationClosed } =
          await import("../services/socketEvents.js");
        const lastMsg = conversation.messages[conversation.messages.length - 1];
        emitNewMessage(conversation._id.toString(), lastMsg);
        emitConversationClosed(conversation._id.toString(), {
          isClosed: true,
          closedBy: "recruiter",
          reason: "application_rejected",
        });
      }
    }

    if (NOTIFY_CANDIDATE_STATUSES.includes(status)) {
      const candidate = await Candidate.findById(application.candidateId);
      const statusMessages = {
        retenue: `Bonne nouvelle ! Votre candidature pour "${application.offerId.titre}" a été retenue.`,
        refusee: `Votre candidature pour "${application.offerId.titre}" n'a pas été retenue.${
          rejectionMessage ? ` Raison: ${rejectionMessage}` : ""
        }`,
      };

      await Notification.create({
        userId: candidate.userId,
        message: statusMessages[status],
        type: status === "retenue" ? "validation" : "info",
      });
    }

    res.json({
      msg: "Statut mis à jour",
      application: {
        _id: application._id,
        recruiterStatus: application.recruiterStatus,
        candidateStatus: application.candidateStatus,
      },
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const toggleStarred = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);
    const { applicationId } = req.params;

    const application =
      await Application.findById(applicationId).populate("offerId");

    if (
      !application ||
      application.offerId.recruteurId.toString() !== recruiter._id.toString()
    ) {
      return res.status(404).json({ msg: "Candidature introuvable" });
    }

    application.isStarred = !application.isStarred;
    await application.save();

    res.json({
      msg: application.isStarred
        ? "Ajoutée aux favoris"
        : "Retirée des favoris",
      isStarred: application.isStarred,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const updateNotes = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);
    const { applicationId } = req.params;
    const { notes } = req.body;

    const application = await Application.findOneAndUpdate(
      {
        _id: applicationId,
        offerId: {
          $in: await Offer.find({ recruteurId: recruiter._id }).distinct("_id"),
        },
      },
      { recruiterNotes: notes },
      { new: true },
    );

    if (!application) {
      return res.status(404).json({ msg: "Candidature introuvable" });
    }

    res.json({ msg: "Notes mises à jour", notes: application.recruiterNotes });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// FIX #9: Batch fetch instead of N+1 queries
export const getAllApplicationsAdvanced = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);
    const {
      status,
      offerId,
      starred,
      hasConversation,
      conversationActive,
      source,
      sortBy = "datePostulation",
      sortOrder = "desc",
      page = 1,
      limit = 20,
    } = req.query;

    const myOfferIds = await Offer.find({
      recruteurId: recruiter._id,
    }).distinct("_id");

    let query = { offerId: { $in: myOfferIds } };

    if (status && status !== "all") {
      query.recruiterStatus = status;
    }
    if (offerId) {
      query.offerId = offerId;
    }
    if (starred === "true") {
      query.isStarred = true;
    }
    if (source) {
      query.source = source;
    }

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

    const [applications, total] = await Promise.all([
      Application.find(query)
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .populate("offerId", "titre")
        .populate({
          path: "candidateId",
          select: "profilePicture userId desiredPosition residence skills",
          populate: { path: "userId", select: "nom email" },
        })
        .lean(),
      Application.countDocuments(query),
    ]);

    // FIX #9: Batch fetch
    const validApps = applications.filter((app) => app.candidateId);
    const appIds = validApps.map((app) => app._id);

    const [conversations, upcomingInterviews] = await Promise.all([
      Conversation.find({ applicationId: { $in: appIds } })
        .select(
          "applicationId candidateHasReplied unreadByRecruiter lastMessageAt",
        )
        .lean(),
      Interview.find({
        applicationId: { $in: appIds },
        status: {
          $in: [
            "proposed",
            "confirmed",
            "rescheduled_by_candidate",
            "rescheduled_by_recruiter",
          ],
        },
        scheduledAt: { $gte: new Date() },
      })
        .sort({ scheduledAt: 1 })
        .lean(),
    ]);

    const convMap = new Map(
      conversations.map((c) => [c.applicationId.toString(), c]),
    );
    const interviewMap = new Map();
    for (const interview of upcomingInterviews) {
      const key = interview.applicationId.toString();
      if (!interviewMap.has(key)) {
        interviewMap.set(key, interview);
      }
    }

    let enriched = validApps.map((app) => {
      const appIdStr = app._id.toString();
      const conversation = convMap.get(appIdStr);
      const upcomingInterview = interviewMap.get(appIdStr);

      return {
        _id: app._id,
        status: app.recruiterStatus,
        source: app.source,
        proposedBy: app.proposedBy,
        isStarred: app.isStarred,
        datePostulation: app.datePostulation,
        offer: {
          _id: app.offerId?._id,
          titre: app.offerId?.titre,
        },
        candidate: {
          _id: app.candidateId._id,
          nom: app.candidateId.userId?.nom,
          email: app.candidateId.userId?.email,
          profilePicture: app.candidateId.profilePicture,
          desiredPosition: app.candidateId.desiredPosition,
          wilaya: app.candidateId.residence?.wilaya,
        },
        conversation: conversation
          ? {
              _id: conversation._id,
              exists: true,
              isActive: conversation.candidateHasReplied,
              unreadCount: conversation.unreadByRecruiter,
              lastMessageAt: conversation.lastMessageAt,
            }
          : {
              _id: null,
              exists: false,
              isActive: false,
            },
        interview: upcomingInterview
          ? {
              exists: true,
              scheduledAt: upcomingInterview.scheduledAt,
              status: upcomingInterview.status,
            }
          : null,
      };
    });

    // Post-filter conversation-based filters (these can't easily be done in DB)
    if (hasConversation === "true") {
      enriched = enriched.filter((a) => a.conversation.exists);
    }
    if (hasConversation === "false") {
      enriched = enriched.filter((a) => !a.conversation.exists);
    }
    if (conversationActive === "true") {
      enriched = enriched.filter((a) => a.conversation.isActive);
    }
    if (conversationActive === "false") {
      enriched = enriched.filter(
        (a) => a.conversation.exists && !a.conversation.isActive,
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

export const markAllOfferApplicationsAsSeen = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);
    const { offerId } = req.params;

    const offer = await Offer.findOne({
      _id: offerId,
      recruteurId: recruiter._id,
    });

    if (!offer) {
      return res.status(404).json({ msg: "Offre introuvable" });
    }

    const result = await Application.updateMany(
      {
        offerId,
        seenByRecruiter: false,
      },
      {
        $set: {
          seenByRecruiter: true,
          seenAt: new Date(),
        },
      },
    );

    await Application.updateMany(
      {
        offerId,
        recruiterStatus: "nouvelle",
      },
      {
        $set: {
          recruiterStatus: "consultee",
          candidateStatus: "en_cours",
        },
        $push: {
          statusHistory: {
            candidateStatus: "en_cours",
            recruiterStatus: "consultee",
            changedBy: req.user.id,
            note: "Vue en masse",
          },
        },
      },
    );

    res.json({
      msg: "Candidatures marquées comme vues",
      modifiedCount: result.modifiedCount,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};
