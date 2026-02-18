// controllers/candidateApplicationController.js
import Application from "../models/Application.js";
import Interview from "../models/Interview.js";
import Conversation from "../models/Conversation.js";
import Candidate from "../models/Candidate.js";
import Notification from "../models/Notification.js";
import Offer from "../models/Offer.js";

// Obtenir toutes mes candidatures
export const getMyApplications = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    if (!candidate) {
      return res.status(404).json({ msg: "Profil introuvable" });
    }

    const { status, page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    let query = { candidateId: candidate._id };

    if (status && status !== "all") {
      query.candidateStatus = status;
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

    // Enrichir avec infos conversation et entretiens
    const enriched = await Promise.all(
      applications.map(async (app) => {
        const [conversation, upcomingInterview, interviewCount] =
          await Promise.all([
            Conversation.findOne({ applicationId: app._id })
              .select("unreadByCandidate lastMessageAt status")
              .lean(),
            Interview.findOne({
              applicationId: app._id,
              status: {
                $in: ["proposed", "confirmed", "rescheduled_by_recruiter"],
              },
              scheduledAt: { $gte: new Date() },
            })
              .sort({ scheduledAt: 1 })
              .lean(),
            Interview.countDocuments({ applicationId: app._id }),
          ]);

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
      }),
    );

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

// Détail d'une candidature
export const getApplicationDetail = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    const { applicationId } = req.params;

    // 1. Get Application with Offer and Company details
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

    // 2. Fetch Conversation and Interviews in parallel
    const [conversation, interviews] = await Promise.all([
      Conversation.findOne({ applicationId })
        .select("_id messages unreadByCandidate status lastMessageAt") // ADDED _id explicitly
        .lean(),
      Interview.find({ applicationId }).sort({ scheduledAt: -1 }).lean(),
    ]);

    // 3. Construct Response
    res.json({
      application: {
        _id: application._id,
        status: application.candidateStatus,
        recruiterStatus: application.recruiterStatus, // Useful for UI timeline
        source: application.source,
        cvUrl: application.cvUrl,
        coverLetter: application.coverLetter,
        datePostulation: application.datePostulation,
        dateDecision: application.dateDecision,
      },
      // Handle case where offer might be deleted (use snapshot if offerId is null)
      offer: application.offerId || application.offerSnapshot,

      // IMPROVEMENT: Send full conversation context
      conversation: conversation
        ? {
            exists: true,
            _id: conversation._id, // CRITICAL: Frontend needs this to "Go to Chat"
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
        // Helper boolean for frontend buttons
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

// Retirer sa candidature
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

    // Vérifier si on peut retirer
    const terminalStatuses = ["retiree", "cancelled", "non_retenue", "retenue"]; // On peut retirer une candidature "retenue" si on refuse l'offre
    if (terminalStatuses.includes(application.candidateStatus)) {
      return res
        .status(400)
        .json({ msg: "Action impossible pour le statut actuel." });
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

    // Annuler les entretiens futurs
    await Interview.updateMany(
      { applicationId, status: { $in: ["proposed", "confirmed"] } },
      { status: "cancelled_by_candidate" },
    );

    // OPTIONNEL : Décrémenter le compteur si vous voulez afficher seulement les candidats "Actifs"
    // Si vous voulez garder le nombre total de reçus, ne mettez pas ce bloc.
    // Je recommande de décrémenter pour que le recruteur voie le nombre de candidats "à traiter".
    await Offer.findByIdAndUpdate(application.offerId, {
      $inc: { nombreCandidatures: -1 },
    });

    // Notifier le recruteur
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
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    const { applicationId } = req.params;

    const application = await Application.findOne({
      _id: applicationId,
      candidateId: candidate._id,
    });

    if (!application)
      return res.status(404).json({ msg: "Candidature introuvable" });

    // Sécurité : On ne peut annuler que si c'est "envoyee" et "pas vue"
    if (
      application.candidateStatus !== "envoyee" ||
      application.seenByRecruiter
    ) {
      return res.status(403).json({
        msg: "Trop tard pour annuler. Utilisez l'option 'Retirer' si disponible.",
      });
    }

    application.candidateStatus = "cancelled";
    application.recruiterStatus = "annulee_par_candidat"; // Nécessite la modif du Model

    application.statusHistory.push({
      candidateStatus: "cancelled",
      recruiterStatus: "annulee_par_candidat",
      changedBy: req.user.id,
      note: "Annulation par le candidat (avant lecture)",
    });

    await application.save();

    // Décrémenter le compteur de l'offre
    await Offer.findByIdAndUpdate(application.offerId, {
      $inc: { nombreCandidatures: -1 },
    });

    res.json({ msg: "Candidature annulée." });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};
// === NOUVELLE FONCTION CRUCIALE POUR LE FRONTEND ===
export const checkApplicationStatus = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    if (!candidate) return res.status(404).json({ msg: "Profil introuvable" });

    const { offerId } = req.params;

    const application = await Application.findOne({
      offerId: offerId,
      candidateId: candidate._id,
    }).populate("offerId", "allowRepostulation"); // On vérifie si l'offre autorise la repostulation

    // Cas 1 : Aucune candidature n'existe
    if (!application) {
      return res.json({
        hasApplied: false,
        status: null,
        canCancel: false,
        canWithdraw: false,
        canRepostulate: false, // Bouton sera "Postuler"
        action: "apply", // Indication pour le frontend
      });
    }

    const { candidateStatus, seenByRecruiter, recruiterStatus } = application;

    // Logique basée sur ton flow
    let canCancel = false;
    let canWithdraw = false;
    let canRepostulate = false;
    let action = "none"; // apply, cancel, withdraw, repostulate, disabled

    // 1. Bouton "Annuler"
    if (
      candidateStatus === "envoyee" &&
      !seenByRecruiter &&
      recruiterStatus === "nouvelle"
    ) {
      canCancel = true;
      action = "cancel";
    }

    // 2. Bouton "Retirer"
    // Disponible si en cours, ou si envoyée mais déjà vue par le recruteur
    const isEnCours =
      ["en_cours"].includes(candidateStatus) ||
      (candidateStatus === "envoyee" && seenByRecruiter);
    if (isEnCours) {
      canWithdraw = true;
      action = "withdraw";
    }

    // 3. Bouton "Repostuler"
    // Si annulée (cancelled) OU retirée (retiree) ET que l'offre le permet
    if (["retiree", "cancelled"].includes(candidateStatus)) {
      if (application.offerId.allowRepostulation !== false) {
        // Par défaut true
        canRepostulate = true;
        action = candidateStatus === "cancelled" ? "apply" : "repostulate"; // Si cancelled, on affiche "Postuler", si retirée "Repostuler"
      } else {
        action = "disabled"; // Repostulation interdite
      }
    }

    // 4. Statuts finaux (Retenue / Non retenue)
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
      action, // Le frontend peut juste regarder ce champ pour savoir quel bouton afficher
      allowRepostulation: application.offerId.allowRepostulation,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};
