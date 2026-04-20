//recruitmentFlowController.js
import Application from "../models/Application.js";
import Interview from "../models/Interview.js";
import Conversation from "../models/Conversation.js";
import Offer from "../models/Offer.js";
import Candidate from "../models/Candidate.js";
import Recruiter from "../models/Recruiter.js";
import User from "../models/User.js";
import Notification from "../models/Notification.js";
import AnemOffer from "../models/AnemOffer.js";
import {
  mapRecruiterToCandidate,
  PREDEFINED_MESSAGES,
  INTERVIEW_INIT_MESSAGE,
} from "../utils/statusMapping.js";
import {
  emitInterviewNew,
  emitInterviewUpdate,
  emitApplicationUpdate,
  emitNewMessage,
} from "../services/socketEvents.js";

// ============================================================
// HELPERS
// ============================================================

const getRecruiterProfile = async (userId) => {
  const recruiter = await Recruiter.findOne({ userId }).populate("companyId");
  if (!recruiter) throw new Error("Profil recruteur non trouvé");
  return recruiter;
};

const findOrFailApplication = async (applicationId, recruiterId) => {
  const application =
    await Application.findById(applicationId).populate("offerId");
  if (!application) throw { status: 404, msg: "Candidature introuvable" };
  if (application.offerId.recruteurId.toString() !== recruiterId.toString()) {
    throw { status: 403, msg: "Non autorisé" };
  }
  return application;
};

const pushStatusHistory = (
  application,
  recruiterStatus,
  candidateStatus,
  changedBy,
  note,
) => {
  application.statusHistory.push({
    candidateStatus,
    recruiterStatus,
    changedBy,
    changedAt: new Date(),
    note,
  });
};
// ▶ NOUVELLE FONCTION UTILITAIRE: Reconciliation de nombreCandidatures
// Appelez cette fonction périodiquement ou après des opérations critiques
export const syncNombreCandidatures = async (offerId) => {
  const activeCount = await Application.countDocuments({
    offerId,
    candidateStatus: { $nin: ["cancelled", "retiree"] },
  });

  await Offer.findByIdAndUpdate(offerId, {
    nombreCandidatures: activeCount,
  });

  return activeCount;
};
// ============================================================
// PHASE 1 : PREMIER CONTACT
// ============================================================

/**
 * POST /api/recruitment/contact/:applicationId
 * Le recruteur contacte un candidat via un message pré-défini
 */
export const initiateContact = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);
    const { applicationId } = req.params;
    const { templateId } = req.body; // greeting, availability, interest, quick_chat

    const application = await findOrFailApplication(
      applicationId,
      recruiter._id,
    );

    // Vérifier si une conversation existe déjà
    const existingConversation = await Conversation.findOne({ applicationId });
    if (existingConversation) {
      return res.json({
        msg: "Une conversation existe déjà",
        conversationId: existingConversation._id,
        alreadyExists: true,
      });
    }

    // Récupérer les infos du candidat
    const candidate = await Candidate.findById(
      application.candidateId,
    ).populate("userId", "nom");
    if (!candidate)
      return res.status(404).json({ msg: "Candidat introuvable" });

    // Valider le template
    const template = PREDEFINED_MESSAGES[templateId];
    if (!template) {
      return res.status(400).json({
        msg: "Template de message invalide",
        availableTemplates: Object.keys(PREDEFINED_MESSAGES),
      });
    }

    // Générer le message
    const messageContent = template.template(
      candidate.userId.nom,
      application.offerId.titre,
    );

    // Créer la conversation
    const conversation = await Conversation.create({
      applicationId,
      offerId: application.offerId._id,
      candidateId: application.candidateId,
      recruiterId: recruiter._id,
      openedBy: req.user.id,
      createdWith: "predefined_message",
      messages: [
        {
          senderId: req.user.id,
          senderType: "recruiter",
          content: messageContent,
          messageType: "predefined",
          metadata: { predefinedTemplateId: templateId },
        },
      ],
      unreadByCandidate: 1,
      lastMessageAt: new Date(),
    });

    // Mettre à jour le statut de la candidature → en_discussion
    if (
      ![
        "en_discussion",
        "entretien_planifie",
        "entretien_termine",
        "retenue",
        "embauche",
        "refusee",
      ].includes(application.recruiterStatus)
    ) {
      application.recruiterStatus = "en_discussion";
      application.candidateStatus = mapRecruiterToCandidate("en_discussion");
      pushStatusHistory(
        application,
        "en_discussion",
        application.candidateStatus,
        req.user.id,
        "Premier contact initié",
      );

      if (!application.seenByRecruiter) {
        application.seenByRecruiter = true;
        application.seenAt = new Date();
      }
      await application.save();
    }

    // Notifier le candidat
    await Notification.create({
      userId: candidate.userId._id,
      message: `Un recruteur essaye de vous contacter pour "${application.offerId.titre}"`,
      type: "info",
    });

    res.status(201).json({
      msg: `Message bien envoyé à ${candidate.userId.nom}`,
      conversationId: conversation._id,
      conversation,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ msg: err.msg });
    res.status(500).json({ msg: err.message });
  }
};

/**
 * GET /api/recruitment/predefined-messages
 * Retourne les templates de messages pré-définis
 */
export const getPredefinedMessages = async (req, res) => {
  const templates = Object.entries(PREDEFINED_MESSAGES).map(([id, t]) => ({
    id,
    preview: t.template("[Nom]", "[Titre du poste]"),
  }));
  res.json(templates);
};

// ============================================================
// PHASE 2 : PROPOSER UN ENTRETIEN
// ============================================================

/**
 * POST /api/recruitment/interviews/:applicationId
 * Le recruteur propose un entretien
 */
export const proposeInterview = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);
    const { applicationId } = req.params;
    const {
      type, // "video" | "phone" | "in_person"
      meetingLink,
      phoneNumber,
      location,
      duration, // 15, 30, 45, 60
      schedulingMode, // "fixed_date" | "propose_slots"
      scheduledAt, // Date fixe
      proposedSlots, // [{date: "..."}] (max 3)
      preparationNotes,
    } = req.body;

    const application = await findOrFailApplication(
      applicationId,
      recruiter._id,
    );

    // Statuts autorisés pour proposer un entretien
    const allowedStatuses = [
      "consultee",
      "preselection",
      "en_discussion",
      "entretien_termine",
      "pending_feedback",
      "shortlisted",
    ];
    if (!allowedStatuses.includes(application.recruiterStatus)) {
      return res.status(400).json({
        msg: "Cette candidature ne peut pas recevoir d'entretien dans son état actuel",
        currentStatus: application.recruiterStatus,
      });
    }

    // Validation des champs selon le type
    if (type === "video" && !meetingLink) {
      return res
        .status(400)
        .json({ msg: "Le lien de réunion est requis pour un entretien vidéo" });
    }
    if (type === "phone" && !phoneNumber) {
      return res.status(400).json({ msg: "Le numéro de téléphone est requis" });
    }
    if (type === "in_person" && !location) {
      return res
        .status(400)
        .json({ msg: "L'adresse est requise pour un entretien présentiel" });
    }

    // Validation du mode de planification
    if (schedulingMode === "fixed_date" && !scheduledAt) {
      return res
        .status(400)
        .json({ msg: "La date et l'heure sont requises pour une date fixe" });
    }
    if (schedulingMode === "propose_slots") {
      if (
        !proposedSlots ||
        proposedSlots.length === 0 ||
        proposedSlots.length > 3
      ) {
        return res.status(400).json({ msg: "Proposez entre 1 et 3 créneaux" });
      }
    }

    // Vérifier s'il existe un entretien actif
    const activeInterview = await Interview.findOne({
      applicationId,
      status: {
        $in: [
          "proposed",
          "confirmed",
          "rescheduled_by_candidate",
          "rescheduled_by_recruiter",
        ],
      },
    });

    if (activeInterview) {
      return res.status(400).json({
        msg: "Un entretien est déjà planifié avec ce candidat. Voulez-vous créer un nouvel entretien ?",
        existingInterviewId: activeInterview._id,
        existingInterviewNumber: activeInterview.interviewNumber,
        requiresConfirmation: true,
      });
    }

    // Calculer le numéro d'entretien
    const completedInterviews = await Interview.countDocuments({
      applicationId,
      status: { $in: ["completed", "no_show_candidate", "no_show_recruiter"] },
    });
    const interviewNumber = completedInterviews + 1;

    // S'assurer qu'une conversation existe (initialiser si nécessaire)
    let conversation = await Conversation.findOne({ applicationId });
    const candidate = await Candidate.findById(
      application.candidateId,
    ).populate("userId", "nom");

    if (!conversation) {
      // Envoyer un message pré-défini d'abord
      const initMessage = INTERVIEW_INIT_MESSAGE.template(candidate.userId.nom);
      conversation = await Conversation.create({
        applicationId,
        offerId: application.offerId._id,
        candidateId: application.candidateId,
        recruiterId: recruiter._id,
        openedBy: req.user.id,
        createdWith: "predefined_message",
        messages: [
          {
            senderId: req.user.id,
            senderType: "system",
            content: initMessage,
            messageType: "predefined",
          },
        ],
        unreadByCandidate: 1,
        lastMessageAt: new Date(),
      });
    }

    // Créer l'entretien
    const interview = await Interview.create({
      applicationId,
      offerId: application.offerId._id,
      candidateId: application.candidateId,
      recruiterId: recruiter._id,
      conversationId: conversation._id,
      interviewNumber,
      type,
      duration: duration || 30,
      location,
      meetingLink,
      phoneNumber,
      schedulingMode: schedulingMode || "fixed_date",
      scheduledAt:
        schedulingMode === "fixed_date" ? new Date(scheduledAt) : null,
      proposedSlots:
        schedulingMode === "propose_slots"
          ? proposedSlots.map((s) => ({
              date: new Date(s.date),
              chosen: false,
            }))
          : [],
      preparationNotes,
      status: "proposed",
    });

    // Ajouter le message "Carte d'entretien" dans la conversation
    const interviewCardMessage = {
      senderId: req.user.id,
      senderType: "system",
      content: `📅 Entretien #${interviewNumber} proposé`,
      messageType: "interview_card",
      metadata: {
        interviewId: interview._id,
        interviewNumber,
      },
    };

    conversation.messages.push(interviewCardMessage);
    conversation.unreadByCandidate += 1;
    conversation.lastMessageAt = new Date();
    conversation.activeInterviewIds.push(interview._id);

    // Stocker l'ID du message pour le sticky bar
    await conversation.save();
    const lastMsg = conversation.messages[conversation.messages.length - 1];
    interview.interviewMessageId = lastMsg._id;
    await interview.save();

    // Mettre à jour le statut de la candidature
    application.recruiterStatus = "entretien_planifie";
    application.candidateStatus = "entretien";
    pushStatusHistory(
      application,
      "entretien_planifie",
      "entretien",
      req.user.id,
      `Entretien #${interviewNumber} proposé`,
    );
    await application.save();

    // ─── NEW: Real-time push ───
    emitInterviewNew(candidate.userId._id.toString(), {
      _id: interview._id,
      interviewNumber,
      type,
      scheduledAt: interview.scheduledAt,
      duration: interview.duration,
      status: "proposed",
      offerTitle: application.offerId.titre,
    });

    // Push the interview card message to the conversation
    emitNewMessage(conversation._id.toString(), interviewCardMessage);

    // Notifier le candidat
    await Notification.create({
      userId: candidate.userId._id,
      message: `Un entretien #${interviewNumber} vous est proposé pour "${application.offerId.titre}"`,
      type: "validation",
    });

    res.status(201).json({
      msg: "Entretien proposé",
      interview,
      interviewNumber,
      conversationId: conversation._id,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ msg: err.msg });
    res.status(500).json({ msg: err.message });
  }
};

/**
 * POST /api/recruitment/interviews/:applicationId/force
 * Forcer la création d'un nouvel entretien (quand un existe déjà)
 */
export const forceNewInterview = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);
    const { applicationId } = req.params;

    // Vérifier qu'il n'y a pas d'entretien confirmé à venir
    const activeInterview = await Interview.findOne({
      applicationId,
      status: {
        $in: [
          "proposed",
          "confirmed",
          "rescheduled_by_candidate",
          "rescheduled_by_recruiter",
        ],
      },
      recruiterId: recruiter._id,
    });

    if (activeInterview) {
      // Annuler l'ancien automatiquement si le recruteur force
      activeInterview.status = "cancelled_by_recruiter";
      activeInterview.cancellationReason = "Remplacé par un nouvel entretien";
      activeInterview.cancelledBy = "recruiter";
      activeInterview.cancelledAt = new Date();
      await activeInterview.save();
    }

    // Réutiliser proposeInterview avec le forçage
    return proposeInterview(req, res);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ msg: err.msg });
    res.status(500).json({ msg: err.message });
  }
};

// ============================================================
// PHASE 3 : CANDIDAT RÉPOND À L'ENTRETIEN
// ============================================================

/**
 * PUT /api/recruitment/interviews/:interviewId/accept
 * Le candidat accepte l'entretien
 */
export const acceptInterview = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    const { interviewId } = req.params;
    const { chosenSlotIndex } = req.body; // Si propose_slots, l'index du créneau choisi

    const interview = await Interview.findOne({
      _id: interviewId,
      candidateId: candidate._id,
      status: { $in: ["proposed", "rescheduled_by_recruiter"] },
    });

    if (!interview) {
      return res
        .status(404)
        .json({ msg: "Entretien introuvable ou déjà traité" });
    }

    // Si créneaux proposés, le candidat doit choisir
    if (interview.schedulingMode === "propose_slots") {
      if (
        chosenSlotIndex === undefined ||
        chosenSlotIndex < 0 ||
        chosenSlotIndex >= interview.proposedSlots.length
      ) {
        return res
          .status(400)
          .json({ msg: "Veuillez choisir un créneau parmi ceux proposés" });
      }
      interview.proposedSlots[chosenSlotIndex].chosen = true;
      interview.chosenSlot = interview.proposedSlots[chosenSlotIndex].date;
      interview.scheduledAt = interview.proposedSlots[chosenSlotIndex].date;
    }

    interview.status = "confirmed";
    await interview.save();

    // Ajouter un message dans la conversation
    const conversation = await Conversation.findById(interview.conversationId);
    if (conversation) {
      conversation.messages.push({
        senderId: req.user.id,
        senderType: "system",
        content: `✅ Entretien #${interview.interviewNumber} confirmé`,
        messageType: "interview_response",
        metadata: { interviewId: interview._id },
      });
      conversation.unreadByRecruiter += 1;
      conversation.lastMessageAt = new Date();
      await conversation.save();
    }

    // Notifier le recruteur
    const recruiter = await Recruiter.findById(interview.recruiterId);
    await Notification.create({
      userId: recruiter.userId,
      message: `Le candidat a confirmé l'entretien #${interview.interviewNumber}`,
      type: "validation",
    });

    // ─── NEW ───
    emitInterviewUpdate(recruiter.userId.toString(), {
      _id: interview._id,
      interviewNumber: interview.interviewNumber,
      status: "confirmed",
      scheduledAt: interview.scheduledAt,
    });
    if (conversation) {
      emitNewMessage(
        conversation._id.toString(),
        conversation.messages[conversation.messages.length - 1],
      );
    }

    res.json({ msg: "Entretien confirmé", interview });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * PUT /api/recruitment/interviews/:interviewId/propose-alternative
 * Le candidat propose une date alternative (Option B)
 */
export const proposeAlternativeDate = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    const { interviewId } = req.params;
    const { newDate, message } = req.body;

    if (!newDate) {
      return res.status(400).json({ msg: "La nouvelle date est requise" });
    }
    if (!message || message.trim().length === 0) {
      return res.status(400).json({
        msg: "Une explication est requise quand vous proposez une alternative",
      });
    }

    const interview = await Interview.findOne({
      _id: interviewId,
      candidateId: candidate._id,
      status: { $in: ["proposed", "rescheduled_by_recruiter"] },
    });

    if (!interview) {
      return res
        .status(404)
        .json({ msg: "Entretien introuvable ou déjà traité" });
    }

    interview.status = "rescheduled_by_candidate";
    interview.proposedAlternative = {
      date: new Date(newDate),
      proposedBy: "candidate",
      message: message.trim(),
      proposedAt: new Date(),
    };
    await interview.save();

    // Ajouter un message "negotiate" dans la conversation
    const conversation = await Conversation.findById(interview.conversationId);
    if (conversation) {
      conversation.messages.push({
        senderId: req.user.id,
        senderType: "candidate",
        content: message.trim(),
        messageType: "negotiate",
        metadata: {
          interviewId: interview._id,
          negotiateTag: true,
        },
      });
      conversation.unreadByRecruiter += 1;
      conversation.lastMessageAt = new Date();
      await conversation.save();
    }

    // Notifier le recruteur
    const recruiter = await Recruiter.findById(interview.recruiterId);
    await Notification.create({
      userId: recruiter.userId,
      message: `Le candidat propose une nouvelle date pour l'entretien #${interview.interviewNumber}`,
      type: "validation",
    });

    // ─── NEW ───
    emitInterviewUpdate(recruiter.userId.toString(), {
      _id: interview._id,
      status: "rescheduled_by_candidate",
      proposedAlternative: interview.proposedAlternative,
    });
    if (conversation) {
      emitNewMessage(
        conversation._id.toString(),
        conversation.messages[conversation.messages.length - 1],
      );
    }

    res.json({ msg: "Proposition envoyée", interview });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * PUT /api/recruitment/interviews/:interviewId/decline
 * Le candidat décline l'entretien (Option C)
 */
export const declineInterview = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    const { interviewId } = req.params;
    const { reason } = req.body;

    const interview = await Interview.findOne({
      _id: interviewId,
      candidateId: candidate._id,
      status: { $in: ["proposed", "rescheduled_by_recruiter"] },
    });

    if (!interview) {
      return res
        .status(404)
        .json({ msg: "Entretien introuvable ou déjà traité" });
    }

    interview.status = "cancelled_by_candidate";
    interview.declineReason = reason;
    interview.cancelledBy = "candidate";
    interview.cancelledAt = new Date();
    await interview.save();

    // Ajouter un message dans la conversation
    const conversation = await Conversation.findById(interview.conversationId);
    if (conversation) {
      conversation.messages.push({
        senderId: req.user.id,
        senderType: "system",
        content: `❌ Le candidat a décliné l'entretien #${interview.interviewNumber}${reason ? ` - Raison: ${reason}` : ""}`,
        messageType: "interview_response",
        metadata: { interviewId: interview._id },
      });
      conversation.unreadByRecruiter += 1;
      conversation.lastMessageAt = new Date();

      // Retirer de la liste des entretiens actifs
      conversation.activeInterviewIds = conversation.activeInterviewIds.filter(
        (id) => id.toString() !== interview._id.toString(),
      );
      await conversation.save();
    }

    // Note: Décliner un entretien ne retire PAS la candidature
    const recruiter = await Recruiter.findById(interview.recruiterId);
    await Notification.create({
      userId: recruiter.userId,
      message: `Le candidat a décliné l'entretien #${interview.interviewNumber}`,
      type: "info",
    });

    // ─── NEW ───
    emitInterviewUpdate(recruiter.userId.toString(), {
      _id: interview._id,
      status: "cancelled_by_candidate",
    });

    res.json({ msg: "Entretien décliné", interview });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// ============================================================
// PHASE 4 : ANNULATION & REPROGRAMMATION
// ============================================================

/**
 * PUT /api/recruitment/interviews/:interviewId/cancel-by-recruiter
 * Le recruteur annule un entretien confirmé (raison obligatoire)
 */
export const cancelInterviewByRecruiter = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);
    const { interviewId } = req.params;
    const { reason } = req.body;

    if (!reason || reason.trim().length === 0) {
      return res
        .status(400)
        .json({ msg: "La raison d'annulation est obligatoire" });
    }

    const interview = await Interview.findOne({
      _id: interviewId,
      recruiterId: recruiter._id,
      status: {
        $in: [
          "proposed",
          "confirmed",
          "rescheduled_by_candidate",
          "rescheduled_by_recruiter",
        ],
      },
    });

    if (!interview) {
      return res
        .status(404)
        .json({ msg: "Entretien introuvable ou déjà terminé" });
    }

    interview.status = "cancelled_by_recruiter";
    interview.cancellationReason = reason.trim();
    interview.cancelledBy = "recruiter";
    interview.cancelledAt = new Date();
    await interview.save();

    // Message dans la conversation
    const conversation = await Conversation.findById(interview.conversationId);
    if (conversation) {
      conversation.messages.push({
        senderId: req.user.id,
        senderType: "system",
        content: `⚠️ L'entretien #${interview.interviewNumber} a été annulé par le recruteur. Raison: ${reason.trim()}`,
        messageType: "system",
        metadata: { interviewId: interview._id },
      });
      conversation.unreadByCandidate += 1;
      conversation.lastMessageAt = new Date();
      conversation.activeInterviewIds = conversation.activeInterviewIds.filter(
        (id) => id.toString() !== interview._id.toString(),
      );
      await conversation.save();
    }

    const candidate = await Candidate.findById(interview.candidateId);
    await Notification.create({
      userId: candidate.userId,
      message: `L'entretien prévu a été annulé par le recruteur`,
      type: "info",
    });

    res.json({ msg: "Entretien annulé", interview });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * PUT /api/recruitment/interviews/:interviewId/cancel-by-candidate
 * Le candidat annule un entretien confirmé (raison obligatoire)
 */
export const cancelInterviewByCandidate = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    const { interviewId } = req.params;
    const { reason } = req.body;

    if (!reason || reason.trim().length === 0) {
      return res
        .status(400)
        .json({ msg: "La raison d'annulation est obligatoire" });
    }

    const interview = await Interview.findOne({
      _id: interviewId,
      candidateId: candidate._id,
      status: { $in: ["proposed", "confirmed", "rescheduled_by_recruiter"] },
    });

    if (!interview) {
      return res
        .status(404)
        .json({ msg: "Entretien introuvable ou déjà terminé" });
    }

    interview.status = "cancelled_by_candidate";
    interview.cancellationReason = reason.trim();
    interview.cancelledBy = "candidate";
    interview.cancelledAt = new Date();
    await interview.save();

    const conversation = await Conversation.findById(interview.conversationId);
    if (conversation) {
      conversation.messages.push({
        senderId: req.user.id,
        senderType: "system",
        content: `⚠️ L'entretien #${interview.interviewNumber} a été annulé par le candidat. Raison: ${reason.trim()}`,
        messageType: "system",
        metadata: { interviewId: interview._id },
      });
      conversation.unreadByRecruiter += 1;
      conversation.lastMessageAt = new Date();
      conversation.activeInterviewIds = conversation.activeInterviewIds.filter(
        (id) => id.toString() !== interview._id.toString(),
      );
      await conversation.save();
    }

    const recruiter = await Recruiter.findById(interview.recruiterId);
    await Notification.create({
      userId: recruiter.userId,
      message: `Le candidat a annulé l'entretien #${interview.interviewNumber}`,
      type: "info",
    });

    res.json({ msg: "Entretien annulé", interview });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * PUT /api/recruitment/interviews/:interviewId/reschedule
 * Le recruteur reprogramme un entretien (propose une nouvelle date)
 */
export const rescheduleByRecruiter = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);
    const { interviewId } = req.params;
    const { newDate, message } = req.body;

    if (!newDate) {
      return res.status(400).json({ msg: "La nouvelle date est requise" });
    }

    const interview = await Interview.findOne({
      _id: interviewId,
      recruiterId: recruiter._id,
      status: { $in: ["confirmed", "rescheduled_by_candidate"] },
    });

    if (!interview) {
      return res.status(404).json({ msg: "Entretien introuvable" });
    }

    interview.scheduledAt = new Date(newDate);
    interview.status = "rescheduled_by_recruiter";
    interview.proposedAlternative = {
      date: new Date(newDate),
      proposedBy: "recruiter",
      message,
      proposedAt: new Date(),
    };
    await interview.save();

    const conversation = await Conversation.findById(interview.conversationId);
    if (conversation) {
      conversation.messages.push({
        senderId: req.user.id,
        senderType: "system",
        content: `🔄 L'entretien #${interview.interviewNumber} a été reprogrammé par le recruteur`,
        messageType: "interview_card",
        metadata: {
          interviewId: interview._id,
          interviewNumber: interview.interviewNumber,
        },
      });
      conversation.unreadByCandidate += 1;
      conversation.lastMessageAt = new Date();
      await conversation.save();
    }

    const candidate = await Candidate.findById(interview.candidateId);
    await Notification.create({
      userId: candidate.userId,
      message: `L'entretien #${interview.interviewNumber} a été reprogrammé, veuillez confirmer la nouvelle date`,
      type: "validation",
    });

    res.json({ msg: "Entretien reprogrammé", interview });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * PUT /api/recruitment/interviews/:interviewId/accept-alternative
 * Le recruteur accepte la date alternative proposée par le candidat
 */
export const acceptAlternativeDate = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);
    const { interviewId } = req.params;

    const interview = await Interview.findOne({
      _id: interviewId,
      recruiterId: recruiter._id,
      status: "rescheduled_by_candidate",
    });

    if (!interview || !interview.proposedAlternative?.date) {
      return res
        .status(404)
        .json({ msg: "Entretien introuvable ou pas de proposition" });
    }

    interview.scheduledAt = interview.proposedAlternative.date;
    interview.status = "confirmed";
    interview.proposedAlternative = undefined;
    await interview.save();

    const conversation = await Conversation.findById(interview.conversationId);
    if (conversation) {
      conversation.messages.push({
        senderId: req.user.id,
        senderType: "system",
        content: `✅ La nouvelle date pour l'entretien #${interview.interviewNumber} a été confirmée`,
        messageType: "interview_response",
        metadata: { interviewId: interview._id },
      });
      conversation.unreadByCandidate += 1;
      conversation.lastMessageAt = new Date();
      await conversation.save();
    }

    const candidate = await Candidate.findById(interview.candidateId);
    await Notification.create({
      userId: candidate.userId,
      message: `Votre nouvelle date d'entretien #${interview.interviewNumber} a été confirmée`,
      type: "validation",
    });

    res.json({ msg: "Nouvelle date acceptée", interview });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * PUT /api/recruitment/interviews/:interviewId/mark-completed
 * Le recruteur marque un entretien comme terminé avant la date prévue
 */
export const markInterviewCompleted = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);
    const { interviewId } = req.params;

    const interview = await Interview.findOne({
      _id: interviewId,
      recruiterId: recruiter._id,
      status: "confirmed",
    });

    if (!interview) {
      return res
        .status(404)
        .json({ msg: "Entretien introuvable ou non confirmé" });
    }

    interview.status = "pending_feedback";
    await interview.save();

    // Mettre à jour la candidature
    const application = await Application.findById(interview.applicationId);
    if (application) {
      application.recruiterStatus = "pending_feedback";
      application.candidateStatus = mapRecruiterToCandidate("pending_feedback");
      pushStatusHistory(
        application,
        "pending_feedback",
        application.candidateStatus,
        req.user.id,
        `Entretien #${interview.interviewNumber} marqué comme terminé`,
      );
      await application.save();
    }

    res.json({
      msg: "Entretien marqué comme terminé, veuillez donner votre feedback",
      interview,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// ============================================================
// PHASE 5 : FEEDBACK POST-ENTRETIEN
// ============================================================

/**
 * POST /api/recruitment/interviews/:interviewId/feedback
 * Le recruteur donne son feedback après l'entretien
 */
export const submitInterviewFeedback = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);
    const { interviewId } = req.params;
    const {
      interviewHappened,
      noShowReason,
      noShowDetails,
      rating,
      privateNotes,
      decision,
      rejectionMessage, // FIX #13: Accept optional rejection message
    } = req.body;

    const interview = await Interview.findOne({
      _id: interviewId,
      recruiterId: recruiter._id,
      status: { $in: ["pending_feedback", "confirmed"] },
    });

    if (!interview) {
      return res
        .status(404)
        .json({ msg: "Entretien introuvable ou feedback non requis" });
    }

    if (interviewHappened === undefined) {
      return res.status(400).json({ msg: "Indiquez si l'entretien a eu lieu" });
    }

    if (!interviewHappened) {
      if (!noShowReason) {
        return res.status(400).json({
          msg: "La raison est requise si l'entretien n'a pas eu lieu",
        });
      }

      interview.feedback = {
        interviewHappened: false,
        noShowReason,
        noShowDetails,
        completedAt: new Date(),
      };

      if (noShowReason === "candidate_absent") {
        interview.status = "no_show_candidate";
      } else {
        interview.status = "completed";
      }

      await interview.save();

      return res.json({
        msg: "Feedback enregistré (entretien non tenu)",
        interview,
        canReschedule: true,
      });
    }

    if (!rating) {
      return res.status(400).json({ msg: "La note est requise" });
    }
    if (!decision) {
      return res.status(400).json({ msg: "La décision est requise" });
    }

    interview.feedback = {
      interviewHappened: true,
      rating,
      privateNotes,
      decision,
      completedAt: new Date(),
    };
    interview.status = "completed";
    await interview.save();

    const application = await Application.findById(
      interview.applicationId,
    ).populate("offerId");
    const candidate = await Candidate.findById(interview.candidateId);
    const conversation = await Conversation.findById(interview.conversationId);

    switch (decision) {
      case "next_round": {
        application.recruiterStatus = "entretien_termine";
        application.candidateStatus =
          mapRecruiterToCandidate("entretien_termine");
        pushStatusHistory(
          application,
          "entretien_termine",
          application.candidateStatus,
          req.user.id,
          `Entretien #${interview.interviewNumber} terminé - Round suivant prévu`,
        );
        await application.save();

        res.json({
          msg: "Feedback enregistré. Vous pouvez proposer un nouvel entretien.",
          interview,
          nextAction: "propose_interview",
          nextInterviewNumber: interview.interviewNumber + 1,
        });
        break;
      }

      case "shortlist": {
        application.recruiterStatus = "shortlisted";
        application.candidateStatus = mapRecruiterToCandidate("shortlisted");
        pushStatusHistory(
          application,
          "shortlisted",
          application.candidateStatus,
          req.user.id,
          "Ajouté à la shortlist",
        );
        await application.save();

        res.json({
          msg: "Candidat ajouté à la shortlist",
          interview,
        });
        break;
      }

      case "reject": {
        application.recruiterStatus = "refusee";
        application.candidateStatus = "non_retenue";
        application.dateDecision = new Date();
        // FIX #13: Store rejection message
        if (rejectionMessage) {
          application.rejectionMessage = rejectionMessage;
        }
        pushStatusHistory(
          application,
          "refusee",
          "non_retenue",
          req.user.id,
          "Rejeté après entretien",
        );
        await application.save();

        if (conversation) {
          conversation.messages.push({
            senderId: req.user.id,
            senderType: "system",
            content: `Votre candidature pour "${application.offerId.titre}" n'a pas été retenue.`,
            messageType: "rejection",
          });
          conversation.isClosed = true;
          conversation.closedReason = "application_rejected";
          conversation.unreadByCandidate += 1;
          conversation.lastMessageAt = new Date();
          await conversation.save();
        }

        await Notification.create({
          userId: candidate.userId,
          message: `Votre candidature pour "${application.offerId.titre}" n'a pas été retenue.${rejectionMessage ? ` Raison: ${rejectionMessage}` : ""}`,
          type: "info",
        });

        res.json({ msg: "Candidat rejeté", interview });
        break;
      }

      case "hire": {
        application.recruiterStatus = "retenue";
        application.candidateStatus = "retenue";
        application.hireOfferedAt = new Date();
        pushStatusHistory(
          application,
          "retenue",
          "retenue",
          req.user.id,
          "Proposition d'embauche envoyée",
        );
        await application.save();

        if (conversation) {
          conversation.messages.push({
            senderId: req.user.id,
            senderType: "system",
            content: `🎉 Félicitations ! Le recruteur souhaite vous embaucher pour le poste "${application.offerId.titre}".`,
            messageType: "hire_offer",
            metadata: { interviewId: interview._id },
          });
          conversation.unreadByCandidate += 1;
          conversation.lastMessageAt = new Date();
          await conversation.save();
        }

        await Notification.create({
          userId: candidate.userId,
          message: `Félicitations ! Vous avez une proposition d'embauche pour "${application.offerId.titre}" !`,
          type: "validation",
        });

        emitApplicationUpdate(candidate.userId.toString(), {
          _id: application._id,
          candidateStatus: "retenue",
          offerTitle: application.offerId.titre,
        });
        if (conversation) {
          emitNewMessage(
            conversation._id.toString(),
            conversation.messages[conversation.messages.length - 1],
          );
        }

        res.json({
          msg: "Proposition d'embauche envoyée au candidat",
          interview,
          nextAction: "awaiting_candidate_response",
        });
        break;
      }
    }
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};
// ============================================================
// PHASE 6 : EMBAUCHE
// ============================================================

/**
 * POST /api/recruitment/hire/:applicationId
 * Le recruteur propose l'embauche (depuis la fiche candidature directement)
 */
export const proposeHire = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);
    const { applicationId } = req.params;

    const application = await findOrFailApplication(
      applicationId,
      recruiter._id,
    );
    const candidate = await Candidate.findById(
      application.candidateId,
    ).populate("userId", "nom");

    // Vérifier que le statut permet l'embauche
    const allowedStatuses = [
      "shortlisted",
      "entretien_termine",
      "pending_feedback",
      "en_discussion",
      "preselection",
    ];
    if (!allowedStatuses.includes(application.recruiterStatus)) {
      return res.status(400).json({
        msg: "Cette candidature ne peut pas recevoir de proposition d'embauche dans son état actuel",
        currentStatus: application.recruiterStatus,
      });
    }

    application.recruiterStatus = "retenue";
    application.candidateStatus = "retenue";
    application.hireOfferedAt = new Date();
    pushStatusHistory(
      application,
      "retenue",
      "retenue",
      req.user.id,
      "Proposition d'embauche envoyée",
    );
    await application.save();

    // Message dans la conversation
    let conversation = await Conversation.findOne({ applicationId });
    if (conversation) {
      conversation.messages.push({
        senderId: req.user.id,
        senderType: "system",
        content: `🎉 Félicitations ! Le recruteur souhaite vous embaucher pour le poste "${application.offerId.titre}".`,
        messageType: "hire_offer",
      });
      conversation.unreadByCandidate += 1;
      conversation.lastMessageAt = new Date();
      await conversation.save();
    }

    await Notification.create({
      userId: candidate.userId._id,
      message: `Félicitations ! Vous avez une proposition d'embauche pour "${application.offerId.titre}" !`,
      type: "validation",
    });

    res.json({ msg: "Proposition d'embauche envoyée", application });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ msg: err.msg });
    res.status(500).json({ msg: err.message });
  }
};

/**
 * PUT /api/recruitment/hire/:applicationId/cancel
 * Le recruteur annule la proposition d'embauche
 */
export const cancelHireOffer = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);
    const { applicationId } = req.params;
    const { reason } = req.body;

    const application = await findOrFailApplication(
      applicationId,
      recruiter._id,
    );

    if (application.recruiterStatus !== "retenue") {
      return res
        .status(400)
        .json({ msg: "Pas de proposition d'embauche active" });
    }

    application.recruiterStatus = "shortlisted"; // Revient en shortlist
    application.candidateStatus = "en_cours";
    application.hireCancelledAt = new Date();
    application.hireCancelReason = reason;
    pushStatusHistory(
      application,
      "shortlisted",
      "en_cours",
      req.user.id,
      `Proposition d'embauche annulée: ${reason || "sans raison"}`,
    );
    await application.save();

    const conversation = await Conversation.findOne({ applicationId });
    if (conversation) {
      conversation.messages.push({
        senderId: req.user.id,
        senderType: "system",
        content: `La proposition d'embauche a été annulée par le recruteur.`,
        messageType: "hire_cancelled",
      });
      conversation.unreadByCandidate += 1;
      conversation.lastMessageAt = new Date();
      await conversation.save();
    }

    const candidate = await Candidate.findById(application.candidateId);
    await Notification.create({
      userId: candidate.userId,
      message: "La proposition d'embauche a été annulée par le recruteur.",
      type: "info",
    });

    res.json({ msg: "Proposition d'embauche annulée", application });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ msg: err.msg });
    res.status(500).json({ msg: err.message });
  }
};

/**
 * PUT /api/recruitment/hire/:applicationId/accept
 * Le candidat accepte l'embauche
 */
export const acceptHire = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    const { applicationId } = req.params;

    const application = await Application.findOne({
      _id: applicationId,
      candidateId: candidate._id,
      recruiterStatus: "retenue",
      candidateStatus: "retenue",
    }).populate("offerId");

    if (!application) {
      return res
        .status(404)
        .json({ msg: "Proposition d'embauche introuvable" });
    }

    application.recruiterStatus = "embauche";
    application.candidateStatus = "embauchee";
    application.hireAcceptedAt = new Date();
    application.dateDecision = new Date();
    pushStatusHistory(
      application,
      "embauche",
      "embauchee",
      req.user.id,
      "Embauche acceptée",
    );
    await application.save();

    // Message dans la conversation
    const conversation = await Conversation.findOne({ applicationId });
    if (conversation) {
      conversation.messages.push({
        senderId: req.user.id,
        senderType: "system",
        content: `🎉 Le candidat a accepté l'embauche pour "${application.offerId.titre}" !`,
        messageType: "hire_response",
      });
      conversation.unreadByRecruiter += 1;
      conversation.lastMessageAt = new Date();
      await conversation.save();
    }

    // Notifier le recruteur
    const offer = application.offerId;
    const recruiter = await Recruiter.findById(offer.recruteurId);
    await Notification.create({
      userId: recruiter.userId,
      message: `Le candidat a accepté l'embauche pour "${offer.titre}" !`,
      type: "validation",
    });

    // Vérifier le quota (hiresNeeded)
    let quotaInfo = null;
    if (offer.hiresNeeded) {
      const hiredCount = await Application.countDocuments({
        offerId: offer._id,
        recruiterStatus: "embauche",
      });

      if (hiredCount >= offer.hiresNeeded) {
        quotaInfo = {
          quotaReached: true,
          hiredCount,
          hiresNeeded: offer.hiresNeeded,
          message: `Vous avez atteint votre quota de recrutement (${hiredCount}/${offer.hiresNeeded}). Voulez-vous clôturer l'offre ?`,
        };
      }
    }
    // ─── NEW ───
    emitApplicationUpdate(recruiter.userId.toString(), {
      _id: application._id,
      recruiterStatus: "embauche",
      offerTitle: application.offerId.titre,
    });
    if (conversation) {
      emitNewMessage(
        conversation._id.toString(),
        conversation.messages[conversation.messages.length - 1],
      );
    }

    res.json({
      msg: "Embauche acceptée ! Félicitations !",
      application,
      quotaInfo,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * PUT /api/recruitment/hire/:applicationId/decline
 * Le candidat décline l'embauche
 */
export const declineHire = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    const { applicationId } = req.params;
    const { reason } = req.body;

    const application = await Application.findOne({
      _id: applicationId,
      candidateId: candidate._id,
      recruiterStatus: "retenue",
      candidateStatus: "retenue",
    }).populate("offerId");

    if (!application) {
      return res
        .status(404)
        .json({ msg: "Proposition d'embauche introuvable" });
    }

    application.recruiterStatus = "offer_declined";
    application.candidateStatus = "en_cours"; // Reste en cours, pas refusée
    application.hireDeclinedAt = new Date();
    application.hireDeclineReason = reason;
    pushStatusHistory(
      application,
      "offer_declined",
      "en_cours",
      req.user.id,
      `Embauche déclinée: ${reason || ""}`,
    );
    await application.save();

    const conversation = await Conversation.findOne({ applicationId });
    if (conversation) {
      conversation.messages.push({
        senderId: req.user.id,
        senderType: "system",
        content: `Le candidat a décliné la proposition d'embauche.${reason ? ` Raison: ${reason}` : ""}`,
        messageType: "hire_response",
      });
      conversation.unreadByRecruiter += 1;
      conversation.lastMessageAt = new Date();
      await conversation.save();
    }

    const offer = application.offerId;
    const recruiter = await Recruiter.findById(offer.recruteurId);
    await Notification.create({
      userId: recruiter.userId,
      message: `Le candidat a décliné l'embauche pour "${offer.titre}"`,
      type: "info",
    });

    res.json({ msg: "Proposition d'embauche déclinée", application });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// ============================================================
// PHASE 7 : NETTOYAGE AUTRES CANDIDATURES
// ============================================================

/**
 * GET /api/recruitment/my-other-applications
 * Le candidat voit ses autres candidatures actives après embauche
 */
export const getOtherActiveApplications = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });

    // Trouver la candidature embauchée
    const hiredApplication = await Application.findOne({
      candidateId: candidate._id,
      candidateStatus: "embauchee",
    });

    if (!hiredApplication) {
      return res.json({ hasHiredApplication: false, otherApplications: [] });
    }

    // Trouver les autres candidatures actives
    const otherActiveApplications = await Application.find({
      candidateId: candidate._id,
      _id: { $ne: hiredApplication._id },
      candidateStatus: { $in: ["envoyee", "en_cours", "entretien", "retenue"] },
    })
      .populate({
        path: "offerId",
        select: "titre companyId",
        populate: { path: "companyId", select: "name logo" },
      })
      .lean();

    res.json({
      hasHiredApplication: true,
      hiredApplicationId: hiredApplication._id,
      otherApplications: otherActiveApplications.map((app) => ({
        _id: app._id,
        status: app.candidateStatus,
        offerTitle: app.offerId?.titre || app.offerSnapshot?.titre,
        companyName:
          app.offerId?.companyId?.name || app.offerSnapshot?.entrepriseNom,
      })),
      count: otherActiveApplications.length,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * POST /api/recruitment/withdraw-all-others
 * Le candidat retire toutes ses autres candidatures
 */
export const withdrawAllOtherApplications = async (req, res) => {
  const mongoose = (await import("mongoose")).default;
  const session = await mongoose.startSession();

  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });

    const hiredApplication = await Application.findOne({
      candidateId: candidate._id,
      candidateStatus: "embauchee",
    });

    if (!hiredApplication) {
      return res
        .status(400)
        .json({ msg: "Aucune candidature embauchée trouvée" });
    }

    let withdrawnCount = 0;
    const affectedOfferIds = new Set();

    await session.withTransaction(async () => {
      const otherApplications = await Application.find({
        candidateId: candidate._id,
        _id: { $ne: hiredApplication._id },
        candidateStatus: {
          $in: ["envoyee", "en_cours", "entretien", "retenue"],
        },
      })
        .populate("offerId")
        .session(session);

      for (const app of otherApplications) {
        app.candidateStatus = "retiree";
        app.recruiterStatus = "retiree_par_candidat";
        app.withdrawnAt = new Date();
        app.withdrawReason = "Embauché(e) ailleurs";
        app.statusHistory.push({
          candidateStatus: "retiree",
          recruiterStatus: "retiree_par_candidat",
          changedBy: req.user.id,
          changedAt: new Date(),
          note: "Retrait automatique - embauché ailleurs",
        });
        await app.save({ session });

        affectedOfferIds.add(app.offerId._id.toString());

        // Annuler les entretiens
        await Interview.updateMany(
          {
            applicationId: app._id,
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
            cancellationReason: "Le candidat a été embauché ailleurs",
            cancelledBy: "candidate",
            cancelledAt: new Date(),
          },
          { session },
        );

        withdrawnCount++;
      }

      // Synchroniser nombreCandidatures pour chaque offre affectée
      for (const oid of affectedOfferIds) {
        const activeCount = await Application.countDocuments({
          offerId: oid,
          candidateStatus: { $nin: ["cancelled", "retiree"] },
        }).session(session);

        await Offer.findByIdAndUpdate(
          oid,
          { nombreCandidatures: activeCount },
          { session },
        );
      }
    });

    // Notifications après transaction
    const withdrawnApps = await Application.find({
      candidateId: candidate._id,
      candidateStatus: "retiree",
      withdrawReason: "Embauché(e) ailleurs",
      withdrawnAt: { $gte: new Date(Date.now() - 10000) },
    }).populate("offerId");

    for (const app of withdrawnApps) {
      if (app.offerId?.recruteurId) {
        const recruiter = await Recruiter.findById(app.offerId.recruteurId);
        if (recruiter) {
          await Notification.create({
            userId: recruiter.userId,
            message: `Le candidat a retiré sa candidature pour "${app.offerId.titre}" (embauché ailleurs)`,
            type: "info",
          });
        }
      }
    }

    res.json({
      msg: `${withdrawnCount} candidature(s) retirée(s)`,
      withdrawnCount,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  } finally {
    await session.endSession();
  }
};

// ============================================================
// PHASE 9 : CLÔTURE D'OFFRE (quota atteint)
// ============================================================

/**
 * POST /api/recruitment/offers/:offerId/close
 * Le recruteur clôture l'offre (quota atteint ou manuellement)
 */
// ▶ REMPLACER closeOffer - Fix: Synchronisation atomique + gestion ANEM
export const closeOffer = async (req, res) => {
  const mongoose = (await import("mongoose")).default;
  const session = await mongoose.startSession();

  try {
    const recruiter = await getRecruiterProfile(req.user.id);
    const { offerId } = req.params;
    const { autoReject } = req.body;

    const offer = await Offer.findOne({
      _id: offerId,
      recruteurId: recruiter._id,
    });

    if (!offer) {
      return res.status(404).json({ msg: "Offre introuvable" });
    }

    let rejectedCount = 0;

    await session.withTransaction(async () => {
      // Désactiver l'offre
      offer.actif = false;
      await offer.save({ session });

      // Désactiver ANEM
      const anemOffer = await AnemOffer.findOne({ offerId: offer._id }).session(
        session,
      );
      if (anemOffer) {
        const cancelableStatuses = [
          "pending_review",
          "depositing",
          "in_cooldown",
        ];
        if (cancelableStatuses.includes(anemOffer.status)) {
          anemOffer.status = "deleted_by_recruiter";
          anemOffer.deletedByRecruiterAt = new Date();
          anemOffer.addAuditEntry("recruiter_deleted", req.user.id, {
            reason: "offer_closed",
          });
          await anemOffer.save({ session });
        }
      }

      if (autoReject) {
        const activeApplications = await Application.find({
          offerId: offer._id,
          recruiterStatus: {
            $nin: [
              "embauche",
              "refusee",
              "retiree_par_candidat",
              "annulee_par_candidat",
              "offer_declined",
            ],
          },
        }).session(session);

        const candidateIds = [];

        for (const app of activeApplications) {
          app.recruiterStatus = "refusee";
          app.candidateStatus = "non_retenue";
          app.dateDecision = new Date();
          app.rejectionMessage = "Le poste a été pourvu.";
          app.statusHistory.push({
            candidateStatus: "non_retenue",
            recruiterStatus: "refusee",
            changedBy: req.user.id,
            changedAt: new Date(),
            note: "Poste pourvu - offre clôturée",
          });
          await app.save({ session });
          candidateIds.push(app.candidateId);

          // Annuler les entretiens
          await Interview.updateMany(
            {
              applicationId: app._id,
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
              status: "cancelled_by_recruiter",
              cancellationReason: "Offre clôturée - poste pourvu",
              cancelledBy: "recruiter",
              cancelledAt: new Date(),
            },
            { session },
          );

          // Fermer la conversation et envoyer le message de rejet
          const conversation = await Conversation.findOne({
            applicationId: app._id,
          }).session(session);

          if (conversation) {
            conversation.messages.push({
              senderId: req.user.id,
              senderType: "system",
              content:
                "Ce poste a été pourvu. Votre candidature n'a pas été retenue.",
              messageType: "closure",
            });
            conversation.isClosed = true;
            conversation.closedReason = "offer_closed";
            conversation.unreadByCandidate += 1;
            conversation.lastMessageAt = new Date();
            await conversation.save({ session });
          }
        }

        rejectedCount = activeApplications.length;

        // Notifications en dehors de la transaction (non critique)
        // On les crée après la transaction
      }

      // Synchroniser le compteur
      const finalCount = await Application.countDocuments({
        offerId: offer._id,
        candidateStatus: { $nin: ["cancelled", "retiree"] },
      }).session(session);

      offer.nombreCandidatures = finalCount;
      await offer.save({ session });
    });

    // Envoyer les notifications après la transaction réussie
    if (autoReject) {
      const rejectedApps = await Application.find({
        offerId: offer._id,
        recruiterStatus: "refusee",
        dateDecision: { $gte: new Date(Date.now() - 5000) }, // Celles qu'on vient de rejeter
      }).populate("candidateId");

      for (const app of rejectedApps) {
        if (app.candidateId?.userId) {
          await Notification.create({
            userId: app.candidateId.userId,
            message: `Le poste "${offer.titre}" a été pourvu. Votre candidature n'a pas été retenue.`,
            type: "info",
          });
        }
      }

      return res.json({
        msg: "Offre clôturée et candidats restants notifiés",
        rejectedCount,
      });
    }

    res.json({ msg: "Offre désactivée", offer });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  } finally {
    await session.endSession();
  }
};

// ============================================================
// GESTION DES EMBAUCHÉS (listes)
// ============================================================

/**
 * GET /api/recruitment/my-hires
 * Le recruteur voit tous ses embauchés
 */
export const getMyHires = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);
    const { offerId } = req.query;

    const myOfferIds = offerId
      ? [offerId]
      : await Offer.find({ recruteurId: recruiter._id }).distinct("_id");

    const hiredApplications = await Application.find({
      offerId: { $in: myOfferIds },
      recruiterStatus: "embauche",
    })
      .populate({
        path: "candidateId",
        select: "profilePicture userId telephone",
        populate: { path: "userId", select: "nom email" },
      })
      .populate("offerId", "titre")
      .sort({ hireAcceptedAt: -1 })
      .lean();

    const enriched = hiredApplications.map((app) => ({
      _id: app._id,
      hireAcceptedAt: app.hireAcceptedAt,
      offer: {
        _id: app.offerId?._id,
        titre: app.offerId?.titre,
      },
      candidate: {
        _id: app.candidateId?._id,
        nom: app.candidateId?.userId?.nom,
        email: app.candidateId?.userId?.email,
        profilePicture: app.candidateId?.profilePicture,
        telephone: app.candidateId?.telephone,
      },
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * PUT /api/recruitment/hire/:applicationId/remove
 * Le recruteur retire un candidat embauché
 */
export const removeHire = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);
    const { applicationId } = req.params;
    const { reason } = req.body;

    const application = await findOrFailApplication(
      applicationId,
      recruiter._id,
    );

    if (application.recruiterStatus !== "embauche") {
      return res.status(400).json({ msg: "Ce candidat n'est pas embauché" });
    }

    application.recruiterStatus = "refusee";
    application.candidateStatus = "non_retenue";
    application.dateDecision = new Date();
    pushStatusHistory(
      application,
      "refusee",
      "non_retenue",
      req.user.id,
      `Embauche retirée: ${reason || "sans raison"}`,
    );
    await application.save();

    const candidate = await Candidate.findById(application.candidateId);
    await Notification.create({
      userId: candidate.userId,
      message: `Votre embauche pour "${application.offerId.titre}" a été annulée par le recruteur.`,
      type: "alerte",
    });

    res.json({ msg: "Embauche retirée", application });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ msg: err.msg });
    res.status(500).json({ msg: err.message });
  }
};

// ============================================================
// AUTO-FEEDBACK TRIGGER (à appeler par un cron job ou scheduler)
// ============================================================

/**
 * Ce n'est pas un endpoint mais une fonction utilitaire
 * À appeler périodiquement pour déclencher le passage automatique
 * en pending_feedback 1h après la fin prévue de l'entretien
 */
export const triggerPendingFeedback = async () => {
  const now = new Date();

  // Trouver les entretiens confirmés dont la fin + 1h est passée
  const interviews = await Interview.find({
    status: "confirmed",
  });

  let updatedCount = 0;

  for (const interview of interviews) {
    if (interview.isFeedbackDue()) {
      interview.status = "pending_feedback";
      await interview.save();

      // Mettre à jour la candidature
      const application = await Application.findById(interview.applicationId);
      if (application && application.recruiterStatus === "entretien_planifie") {
        application.recruiterStatus = "pending_feedback";
        application.candidateStatus =
          mapRecruiterToCandidate("pending_feedback");
        application.statusHistory.push({
          candidateStatus: application.candidateStatus,
          recruiterStatus: "pending_feedback",
          changedBy: null, // Système
          note: `Feedback requis pour l'entretien #${interview.interviewNumber}`,
        });
        await application.save();
      }

      // Notifier le recruteur
      const recruiter = await Recruiter.findById(interview.recruiterId);
      if (recruiter) {
        await Notification.create({
          userId: recruiter.userId,
          message: `Action requise : donnez votre feedback sur l'entretien #${interview.interviewNumber}`,
          type: "alerte",
        });
      }

      updatedCount++;
    }
  }

  return updatedCount;
};

// ============================================================
// RAPPELS AUTOMATIQUES (24h avant)
// ============================================================

export const sendInterviewReminders = async () => {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const isDevelopment = process.env.NODE_ENV !== "production";

  if (isDevelopment) {
    console.log("📧 [DEV MODE] Pas d'envoi de rappels d'entretien");
    return 0;
  }

  const interviews = await Interview.find({
    status: "confirmed",
    scheduledAt: { $gte: now, $lte: in24h },
    reminderSentToCandidate: false,
  })
    .populate("candidateId")
    .populate("recruiterId");

  let sentCount = 0;

  for (const interview of interviews) {
    // Rappel candidat
    if (interview.candidateId?.userId) {
      await Notification.create({
        userId: interview.candidateId.userId,
        message: `Rappel : vous avez un entretien demain`,
        type: "info",
      });
    }

    // Rappel recruteur
    if (interview.recruiterId?.userId) {
      await Notification.create({
        userId: interview.recruiterId.userId,
        message: `Rappel : vous avez un entretien demain`,
        type: "info",
      });
    }

    interview.reminderSentToCandidate = true;
    interview.reminderSentToRecruiter = true;
    interview.reminderSentAt = new Date();
    await interview.save();
    sentCount++;
  }

  return sentCount;
};
