// controllers/recruiterApplicationController.js
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

// Helper pour récupérer le profil recruteur
const getRecruiterProfile = async (userId) => {
  const recruiter = await Recruiter.findOne({ userId }).populate("companyId");
  if (!recruiter) throw new Error("Profil recruteur non trouvé");
  return recruiter;
};

// Candidatures pour une offre
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

    // Vérifier que l'offre appartient au recruteur
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

    // Filtrer les candidats supprimés et enrichir
    const enriched = await Promise.all(
      applications
        .filter((app) => app.candidateId !== null)
        .map(async (app) => {
          const [conversation, upcomingInterview] = await Promise.all([
            Conversation.findOne({ applicationId: app._id })
              .select("unreadByRecruiter lastMessageAt")
              .lean(),
            Interview.findOne({
              applicationId: app._id,
              status: {
                $in: ["proposed", "confirmed", "rescheduled_by_candidate"],
              },
              scheduledAt: { $gte: new Date() },
            })
              .sort({ scheduledAt: 1 })
              .lean(),
          ]);

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
        }),
    );

    // Transformer statusCounts en objet
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

// Marquer comme vu (automatique quand on consulte le détail)
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

// Changer le statut recruteur
export const updateRecruiterStatus = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);
    const { applicationId } = req.params;
    const { status, notes } = req.body;

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

    // Vérifier transition valide
    const validTransitions = {
      nouvelle: ["consultee", "preselection", "refusee"],
      consultee: ["preselection", "en_discussion", "refusee"],
      preselection: ["en_discussion", "entretien_planifie", "refusee"],
      en_discussion: ["preselection", "entretien_planifie", "refusee"],
      entretien_planifie: ["entretien_termine", "refusee"],
      entretien_termine: ["retenue", "refusee", "entretien_planifie"], // Peut replanifier
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

    application.statusHistory.push({
      candidateStatus: application.candidateStatus,
      recruiterStatus: status,
      changedBy: req.user.id,
      note: notes,
    });

    await application.save();

    // Notifier le candidat si nécessaire
    if (NOTIFY_CANDIDATE_STATUSES.includes(status)) {
      const candidate = await Candidate.findById(application.candidateId);
      const statusMessages = {
        retenue: `Bonne nouvelle ! Votre candidature pour "${application.offerId.titre}" a été retenue.`,
        refusee: `Votre candidature pour "${application.offerId.titre}" n'a pas été retenue.`,
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

// Toggle favori
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

// Notes recruteur
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

// Vue globale toutes candidatures
/* export const getAllApplications = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);
    const { status, offerId, page = 1, limit = 20 } = req.query;

    const myOfferIds = await Offer.find({
      recruteurId: recruiter._id,
    }).distinct("_id");

    let query = { offerId: { $in: myOfferIds } };

    if (status) query.recruiterStatus = status;
    if (offerId) query.offerId = offerId;

    const skip = (page - 1) * limit;

    const [applications, total] = await Promise.all([
      Application.find(query)
        .sort({ datePostulation: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate("offerId", "titre")
        .populate({
          path: "candidateId",
          select: "profilePicture userId",
          populate: { path: "userId", select: "nom" },
        })
        .lean(),
      Application.countDocuments(query),
    ]);

    res.json({
      data: applications.filter((a) => a.candidateId),
      meta: {
        total,
        page: parseInt(page),
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
}; */

export const getAllApplicationsAdvanced = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);
    const {
      status,
      offerId,
      starred,
      hasConversation,
      conversationActive, // candidateHasReplied
      source, // 'direct' ou 'admin_proposal'
      sortBy = "datePostulation",
      sortOrder = "desc",
      page = 1,
      limit = 20,
    } = req.query;

    const myOfferIds = await Offer.find({
      recruteurId: recruiter._id,
    }).distinct("_id");

    let query = { offerId: { $in: myOfferIds } };

    // Filtres
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

    let applications = await Application.find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .populate("offerId", "titre")
      .populate({
        path: "candidateId",
        select: "profilePicture userId desiredPosition residence skills",
        populate: { path: "userId", select: "nom email" },
      })
      .lean();

    // Enrichir avec les données de conversation
    const enriched = await Promise.all(
      applications
        .filter((app) => app.candidateId)
        .map(async (app) => {
          const conversation = await Conversation.findOne({
            applicationId: app._id,
          })
            .select("candidateHasReplied unreadByRecruiter lastMessageAt")
            .lean();

          const upcomingInterview = await Interview.findOne({
            applicationId: app._id,
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
            .lean();

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
                  exists: true,
                  isActive: conversation.candidateHasReplied,
                  unreadCount: conversation.unreadByRecruiter,
                  lastMessageAt: conversation.lastMessageAt,
                }
              : {
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
        }),
    );

    // Filtres post-query (conversation)
    let filtered = enriched;
    if (hasConversation === "true") {
      filtered = filtered.filter((a) => a.conversation.exists);
    }
    if (hasConversation === "false") {
      filtered = filtered.filter((a) => !a.conversation.exists);
    }
    if (conversationActive === "true") {
      filtered = filtered.filter((a) => a.conversation.isActive);
    }
    if (conversationActive === "false") {
      filtered = filtered.filter(
        (a) => a.conversation.exists && !a.conversation.isActive,
      );
    }

    const total = await Application.countDocuments(query);

    res.json({
      data: filtered,
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

    // Vérifier que l'offre appartient au recruteur
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

    // Mettre à jour le statut des nouvelles candidatures
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
