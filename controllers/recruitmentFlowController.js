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
  emitInterviewCardUpdate,
  emitApplicationUpdate,
  emitNewMessage,
  emitConversationClosed,
  emitConversationUpdate,
  emitUnreadCount,
} from "../services/socketEvents.js";

/* ═══════════════════ HELPERS ═══════════════════ */

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

// Statuts considérés comme ACTIFS pour nombreCandidatures
const ACTIVE_CANDIDATE_STATUSES = [
  "envoyee",
  "en_cours",
  "entretien",
  "retenue",
];

/**
 * Recalcule nombreCandidatures = candidatures ACTIVES.
 * Source unique de vérité. À appeler après toute transition de statut.
 * Accepte une session optionnelle pour usage transactionnel.
 */
export const syncNombreCandidatures = async (offerId, session = null) => {
  const query = Application.countDocuments({
    offerId,
    candidateStatus: { $in: ACTIVE_CANDIDATE_STATUSES },
  });
  if (session) query.session(session);
  const activeCount = await query;

  const update = Offer.findByIdAndUpdate(offerId, {
    nombreCandidatures: activeCount,
  });
  if (session) update.session(session);
  await update;

  return activeCount;
};

/* Helper pour pousser un message système + resync unread + socket */
const pushSystemMessage = async (
  conversation,
  {
    senderId,
    content,
    messageType = "system",
    metadata = {},
    toCandidate = true,
  },
) => {
  if (!conversation) return null;
  conversation.messages.push({
    senderId,
    senderType: "system",
    content,
    messageType,
    metadata,
  });
  if (toCandidate) conversation.unreadByCandidate += 1;
  else conversation.unreadByRecruiter += 1;
  conversation.lastMessageAt = new Date();
  await conversation.save();

  const lastMsg = conversation.messages[conversation.messages.length - 1];
  emitNewMessage(conversation._id.toString(), lastMsg);
  return lastMsg;
};

/* ═══════════════════ PHASE 1 : CONTACT ═══════════════════ */

export const initiateContact = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);
    const { applicationId } = req.params;
    const { templateId, customMessage } = req.body;

    const application = await findOrFailApplication(
      applicationId,
      recruiter._id,
    );

    const existingConversation = await Conversation.findOne({ applicationId });
    if (existingConversation) {
      return res.json({
        msg: "Une conversation existe déjà",
        conversationId: existingConversation._id,
        alreadyExists: true,
      });
    }

    const candidate = await Candidate.findById(
      application.candidateId,
    ).populate("userId", "nom");
    if (!candidate)
      return res.status(404).json({ msg: "Candidat introuvable" });

    // Determine message content: custom takes precedence
    let messageContent;
    let createdWith = "predefined_message";
    let usedTemplateId = null;

    if (customMessage && customMessage.trim().length > 0) {
      messageContent = customMessage.trim().slice(0, 5000);
      createdWith = "custom_message";
    } else {
      const template = PREDEFINED_MESSAGES[templateId];
      if (!template) {
        return res.status(400).json({
          msg: "Template de message invalide",
          availableTemplates: Object.keys(PREDEFINED_MESSAGES),
        });
      }
      messageContent = template.template(
        candidate.userId.nom,
        application.offerId.titre,
      );
      usedTemplateId = templateId;
    }

    const conversation = await Conversation.create({
      applicationId,
      offerId: application.offerId._id,
      candidateId: application.candidateId,
      recruiterId: recruiter._id,
      openedBy: req.user.id,
      createdWith,
      messages: [
        {
          senderId: req.user.id,
          senderType: "recruiter",
          content: messageContent,
          messageType: createdWith === "custom_message" ? "text" : "predefined",
          metadata: usedTemplateId
            ? { predefinedTemplateId: usedTemplateId }
            : {},
        },
      ],
      unreadByCandidate: 1,
      lastMessageAt: new Date(),
    });

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

    const firstMsg = conversation.messages[conversation.messages.length - 1];
    emitNewMessage(conversation._id.toString(), firstMsg, { applicationId });
    emitConversationUpdate(candidate.userId._id.toString(), {
      _id: conversation._id,
      applicationId,
      lastMessage: firstMsg,
      unreadCount: 1,
      lastMessageAt: conversation.lastMessageAt,
    });
    emitUnreadCount(candidate.userId._id.toString(), { conversations: 1 });

    await Notification.create({
      userId: candidate.userId._id,
      message: `Un recruteur essaye de vous contacter pour "${application.offerId.titre}"`,
      type: "info",
      meta: {
        category: "message",
        conversationId: conversation._id,
        applicationId: application._id,
      },
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

export const getPredefinedMessages = async (req, res) => {
  const templates = Object.entries(PREDEFINED_MESSAGES).map(([id, t]) => ({
    id,
    preview: t.template("[Nom]", "[Titre du poste]"),
  }));
  res.json(templates);
};

/* ═══════════════════ PHASE 2 : PROPOSITION D'ENTRETIEN ═══════════════════ */
/**
 * Crée TOUJOURS un entretien (pas de blocage). Permet plusieurs entretiens
 * actifs en parallèle (ex : plusieurs candidats). Le numéro est calculé
 * globalement sur la candidature. Anti-double-clic géré côté frontend.
 */
export const proposeInterview = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);
    const { applicationId } = req.params;
    const {
      type,
      meetingLink,
      phoneNumber,
      location,
      duration,
      schedulingMode,
      scheduledAt,
      proposedSlots,
      preparationNotes,
    } = req.body;

    const application = await findOrFailApplication(
      applicationId,
      recruiter._id,
    );

    const allowedStatuses = [
      "consultee",
      "preselection",
      "en_discussion",
      "entretien_planifie",
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

    // Numéro d'entretien = nombre total d'entretiens déjà créés + 1
    const totalInterviews = await Interview.countDocuments({ applicationId });
    const interviewNumber = totalInterviews + 1;

    // Conversation : créée si absente
    let conversation = await Conversation.findOne({ applicationId });
    const candidate = await Candidate.findById(
      application.candidateId,
    ).populate("userId", "nom");

    if (!conversation) {
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

    const interviewCardMessage = {
      senderId: req.user.id,
      senderType: "system",
      content: `📅 Entretien #${interviewNumber} proposé`,
      messageType: "interview_card",
      metadata: { interviewId: interview._id, interviewNumber },
    };
    conversation.messages.push(interviewCardMessage);
    conversation.unreadByCandidate += 1;
    conversation.lastMessageAt = new Date();
    conversation.activeInterviewIds.push(interview._id);
    await conversation.save();

    const lastMsg = conversation.messages[conversation.messages.length - 1];
    interview.interviewMessageId = lastMsg._id;
    await interview.save();

    // La candidature passe à "entretien planifié" (sans régresser un statut avancé)
    if (
      [
        "consultee",
        "preselection",
        "en_discussion",
        "shortlisted",
        "entretien_termine",
        "pending_feedback",
      ].includes(application.recruiterStatus)
    ) {
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
    }

    // Real-time — emit a fully populated interview card so both parties
    // render the card instantly without an extra fetch.
    const freshInterview = await Interview.findById(interview._id).lean();

    emitInterviewNew(candidate.userId._id.toString(), {
      _id: interview._id,
      interviewNumber,
      type,
      scheduledAt: interview.scheduledAt,
      duration: interview.duration,
      status: "proposed",
      offerTitle: application.offerId.titre,
    });

    // Ship the message to the room, then immediately patch the card with full data
    emitNewMessage(conversation._id.toString(), lastMsg);
    emitInterviewCardUpdate(conversation._id.toString(), freshInterview);

    await Notification.create({
      userId: candidate.userId._id,
      message: `Un entretien #${interviewNumber} vous est proposé pour "${application.offerId.titre}"`,
      type: "validation",
      meta: {
        category: "interview",
        interviewId: interview._id,
        conversationId: conversation._id,
        applicationId: application._id,
        interviewScheduled: !!interview.scheduledAt,
      },
    });

    res.status(201).json({
      msg: `Entretien #${interviewNumber} proposé`,
      interview,
      interviewNumber,
      conversationId: conversation._id,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ msg: err.msg });
    res.status(500).json({ msg: err.message });
  }
};

/* ═══════════════════ PHASE 3 : RÉPONSES CANDIDAT ═══════════════════ */

// Recharge l'interview populée puis émet le patch de carte aux deux participants
const emitCardRefresh = async (interviewId, conversationId) => {
  const fresh = await Interview.findById(interviewId).lean();
  if (fresh && conversationId) {
    emitInterviewCardUpdate(conversationId.toString(), fresh);
  }
  return fresh;
};

export const acceptInterview = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    const { interviewId } = req.params;
    const { chosenSlotIndex } = req.body;

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

    const conversation = await Conversation.findById(interview.conversationId);
    if (conversation) {
      await pushSystemMessage(conversation, {
        senderId: req.user.id,
        content: `✅ Entretien #${interview.interviewNumber} confirmé`,
        messageType: "interview_response",
        metadata: { interviewId: interview._id },
        toCandidate: false,
      });
    }

    const recruiter = await Recruiter.findById(interview.recruiterId);
    await Notification.create({
      userId: recruiter.userId,
      message: `Le candidat a confirmé l'entretien #${interview.interviewNumber}`,
      type: "validation",
    });

    emitInterviewUpdate(recruiter.userId.toString(), {
      _id: interview._id,
      interviewNumber: interview.interviewNumber,
      status: "confirmed",
      scheduledAt: interview.scheduledAt,
    });
    await emitCardRefresh(interview._id, interview.conversationId);

    res.json({ msg: "Entretien confirmé", interview });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

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

    const conversation = await Conversation.findById(interview.conversationId);
    if (conversation) {
      conversation.messages.push({
        senderId: req.user.id,
        senderType: "candidate",
        content: message.trim(),
        messageType: "negotiate",
        metadata: { interviewId: interview._id, negotiateTag: true },
      });
      conversation.unreadByRecruiter += 1;
      conversation.lastMessageAt = new Date();
      await conversation.save();
      const lastMsg = conversation.messages[conversation.messages.length - 1];
      emitNewMessage(conversation._id.toString(), lastMsg);
    }

    const recruiter = await Recruiter.findById(interview.recruiterId);
    await Notification.create({
      userId: recruiter.userId,
      message: `Le candidat propose une nouvelle date pour l'entretien #${interview.interviewNumber}`,
      type: "validation",
    });

    emitInterviewUpdate(recruiter.userId.toString(), {
      _id: interview._id,
      status: "rescheduled_by_candidate",
      proposedAlternative: interview.proposedAlternative,
    });
    await emitCardRefresh(interview._id, interview.conversationId);

    res.json({ msg: "Proposition envoyée", interview });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

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

    const conversation = await Conversation.findById(interview.conversationId);
    if (conversation) {
      conversation.activeInterviewIds = conversation.activeInterviewIds.filter(
        (id) => id.toString() !== interview._id.toString(),
      );
      await pushSystemMessage(conversation, {
        senderId: req.user.id,
        content: `❌ Le candidat a décliné l'entretien #${interview.interviewNumber}${reason ? ` — Raison: ${reason}` : ""}`,
        messageType: "interview_response",
        metadata: { interviewId: interview._id },
        toCandidate: false,
      });
    }

    const recruiter = await Recruiter.findById(interview.recruiterId);
    await Notification.create({
      userId: recruiter.userId,
      message: `Le candidat a décliné l'entretien #${interview.interviewNumber}`,
      type: "info",
    });

    emitInterviewUpdate(recruiter.userId.toString(), {
      _id: interview._id,
      status: "cancelled_by_candidate",
    });
    await emitCardRefresh(interview._id, interview.conversationId);

    res.json({ msg: "Entretien décliné", interview });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/* ═══════════════════ PHASE 4 : GESTION RECRUTEUR ═══════════════════ */

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

    const conversation = await Conversation.findById(interview.conversationId);
    if (conversation) {
      conversation.activeInterviewIds = conversation.activeInterviewIds.filter(
        (id) => id.toString() !== interview._id.toString(),
      );
      await pushSystemMessage(conversation, {
        senderId: req.user.id,
        content: `⚠️ L'entretien #${interview.interviewNumber} a été annulé par le recruteur. Raison: ${reason.trim()}`,
        messageType: "system",
        metadata: { interviewId: interview._id },
        toCandidate: true,
      });
    }

    const candidate = await Candidate.findById(interview.candidateId);
    await Notification.create({
      userId: candidate.userId,
      message: `L'entretien prévu a été annulé par le recruteur`,
      type: "info",
      meta: {
        category: "interview",
        interviewId: interview._id,
        conversationId: interview.conversationId,
        applicationId: interview.applicationId,
        interviewScheduled: !!interview.scheduledAt,
      },
    });

    emitInterviewUpdate(candidate.userId.toString(), {
      _id: interview._id,
      status: "cancelled_by_recruiter",
    });
    await emitCardRefresh(interview._id, interview.conversationId);

    res.json({ msg: "Entretien annulé", interview });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

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
      conversation.activeInterviewIds = conversation.activeInterviewIds.filter(
        (id) => id.toString() !== interview._id.toString(),
      );
      await pushSystemMessage(conversation, {
        senderId: req.user.id,
        content: `⚠️ L'entretien #${interview.interviewNumber} a été annulé par le candidat. Raison: ${reason.trim()}`,
        messageType: "system",
        metadata: { interviewId: interview._id },
        toCandidate: false,
      });
    }

    const recruiter = await Recruiter.findById(interview.recruiterId);
    await Notification.create({
      userId: recruiter.userId,
      message: `Le candidat a annulé l'entretien #${interview.interviewNumber}`,
      type: "info",
    });

    emitInterviewUpdate(recruiter.userId.toString(), {
      _id: interview._id,
      status: "cancelled_by_candidate",
    });
    await emitCardRefresh(interview._id, interview.conversationId);

    res.json({ msg: "Entretien annulé", interview });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

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
      await pushSystemMessage(conversation, {
        senderId: req.user.id,
        content: `🔄 L'entretien #${interview.interviewNumber} a été reprogrammé par le recruteur`,
        messageType: "interview_card",
        metadata: {
          interviewId: interview._id,
          interviewNumber: interview.interviewNumber,
        },
        toCandidate: true,
      });
    }

    const candidate = await Candidate.findById(interview.candidateId);
    await Notification.create({
      userId: candidate.userId,
      message: `L'entretien #${interview.interviewNumber} a été reprogrammé, veuillez confirmer la nouvelle date`,
      type: "validation",
      meta: {
        category: "interview",
        interviewId: interview._id,
        conversationId: interview.conversationId,
        applicationId: interview.applicationId,
        interviewScheduled: !!interview.scheduledAt,
      },
    });

    emitInterviewUpdate(candidate.userId.toString(), {
      _id: interview._id,
      status: "rescheduled_by_recruiter",
      scheduledAt: interview.scheduledAt,
    });
    await emitCardRefresh(interview._id, interview.conversationId);

    res.json({ msg: "Entretien reprogrammé", interview });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

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
      await pushSystemMessage(conversation, {
        senderId: req.user.id,
        content: `✅ La nouvelle date pour l'entretien #${interview.interviewNumber} a été confirmée`,
        messageType: "interview_response",
        metadata: { interviewId: interview._id },
        toCandidate: true,
      });
    }

    const candidate = await Candidate.findById(interview.candidateId);
    await Notification.create({
      userId: candidate.userId,
      message: `Votre nouvelle date d'entretien #${interview.interviewNumber} a été confirmée`,
      type: "validation",
      meta: {
        category: "interview",
        interviewId: interview._id,
        conversationId: interview.conversationId,
        applicationId: interview.applicationId,
        interviewScheduled: true,
      },
    });

    emitInterviewUpdate(candidate.userId.toString(), {
      _id: interview._id,
      status: "confirmed",
      scheduledAt: interview.scheduledAt,
    });
    await emitCardRefresh(interview._id, interview.conversationId);

    res.json({ msg: "Nouvelle date acceptée", interview });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

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

    // Garde : ne pas régresser un statut déjà avancé
    const application = await Application.findById(interview.applicationId);
    if (
      application &&
      ["entretien_planifie", "entretien_termine"].includes(
        application.recruiterStatus,
      )
    ) {
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

    await emitCardRefresh(interview._id, interview.conversationId);

    res.json({
      msg: "Entretien marqué comme terminé, veuillez donner votre feedback",
      interview,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/* ═══════════════════ PHASE 5 : FEEDBACK ═══════════════════ */

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
      rejectionMessage,
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
      interview.status =
        noShowReason === "candidate_absent" ? "no_show_candidate" : "completed";
      await interview.save();
      await emitCardRefresh(interview._id, interview.conversationId);

      return res.json({
        msg: "Feedback enregistré (entretien non tenu)",
        interview,
        canReschedule: true,
      });
    }

    if (!rating) return res.status(400).json({ msg: "La note est requise" });
    if (!decision)
      return res.status(400).json({ msg: "La décision est requise" });

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
        await emitCardRefresh(interview._id, interview.conversationId);
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
        await emitCardRefresh(interview._id, interview.conversationId);
        res.json({ msg: "Candidat ajouté à la shortlist", interview });
        break;
      }
      case "reject": {
        application.recruiterStatus = "refusee";
        application.candidateStatus = "non_retenue";
        application.dateDecision = new Date();
        if (rejectionMessage) application.rejectionMessage = rejectionMessage;
        pushStatusHistory(
          application,
          "refusee",
          "non_retenue",
          req.user.id,
          "Rejeté après entretien",
        );
        await application.save();
        await syncNombreCandidatures(application.offerId._id);

        if (conversation) {
          conversation.messages.push({
            senderId: req.user.id,
            senderType: "system",
            content: `Votre candidature pour "${application.offerId.titre}" n'a pas été retenue.${rejectionMessage ? ` Message : ${rejectionMessage}` : ""}`,
            messageType: "rejection",
          });
          conversation.isClosed = true;
          conversation.closedReason = "application_rejected";
          conversation.unreadByCandidate += 1;
          conversation.lastMessageAt = new Date();
          await conversation.save();
          const lastMsg =
            conversation.messages[conversation.messages.length - 1];
          emitNewMessage(conversation._id.toString(), lastMsg);
          emitConversationClosed(conversation._id.toString(), {
            isClosed: true,
            closedBy: "recruiter",
            reason: "application_rejected",
          });
        }

        await Notification.create({
          userId: candidate.userId,
          message: `Votre candidature pour "${application.offerId.titre}" n'a pas été retenue.${rejectionMessage ? ` Raison: ${rejectionMessage}` : ""}`,
          type: "info",
          meta: {
            category: "application",
            applicationId: application._id,
            conversationId: interview.conversationId,
          },
        });

        emitApplicationUpdate(candidate.userId.toString(), {
          _id: application._id,
          candidateStatus: "non_retenue",
          offerTitle: application.offerId.titre,
        });
        await emitCardRefresh(interview._id, interview.conversationId);
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
          await pushSystemMessage(conversation, {
            senderId: req.user.id,
            content: `🎉 Félicitations ! Le recruteur souhaite vous embaucher pour le poste "${application.offerId.titre}".`,
            messageType: "hire_offer",
            metadata: {
              interviewId: interview._id,
              applicationId: application._id,
            },
            toCandidate: true,
          });
        }

        await Notification.create({
          userId: candidate.userId,
          message: `Félicitations ! Vous avez une proposition d'embauche pour "${application.offerId.titre}" !`,
          type: "validation",
          meta: {
            category: "application",
            applicationId: application._id,
            conversationId: interview.conversationId,
          },
        });

        emitApplicationUpdate(candidate.userId.toString(), {
          _id: application._id,
          candidateStatus: "retenue",
          offerTitle: application.offerId.titre,
        });
        await emitCardRefresh(interview._id, interview.conversationId);
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

/* ═══════════════════ PHASE 6 : EMBAUCHE ═══════════════════ */

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

    let conversation = await Conversation.findOne({ applicationId });
    if (conversation) {
      await pushSystemMessage(conversation, {
        senderId: req.user.id,
        content: `🎉 Félicitations ! Le recruteur souhaite vous embaucher pour le poste "${application.offerId.titre}".`,
        messageType: "hire_offer",
        metadata: { applicationId: application._id },
        toCandidate: true,
      });
    }

    await Notification.create({
      userId: candidate.userId._id,
      message: `Félicitations ! Vous avez une proposition d'embauche pour "${application.offerId.titre}" !`,
      type: "validation",
      meta: {
        category: "application",
        applicationId: application._id,
      },
    });

    emitApplicationUpdate(candidate.userId._id.toString(), {
      _id: application._id,
      candidateStatus: "retenue",
      offerTitle: application.offerId.titre,
    });

    res.json({ msg: "Proposition d'embauche envoyée", application });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ msg: err.msg });
    res.status(500).json({ msg: err.message });
  }
};

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

    application.recruiterStatus = "shortlisted";
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
      await pushSystemMessage(conversation, {
        senderId: req.user.id,
        content: `La proposition d'embauche a été annulée par le recruteur.`,
        messageType: "hire_cancelled",
        toCandidate: true,
      });
    }

    const candidate = await Candidate.findById(application.candidateId);
    await Notification.create({
      userId: candidate.userId,
      message: "La proposition d'embauche a été annulée par le recruteur.",
      type: "info",
    });
    emitApplicationUpdate(candidate.userId.toString(), {
      _id: application._id,
      candidateStatus: "en_cours",
    });

    res.json({ msg: "Proposition d'embauche annulée", application });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ msg: err.msg });
    res.status(500).json({ msg: err.message });
  }
};

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
    await syncNombreCandidatures(application.offerId._id);

    const conversation = await Conversation.findOne({ applicationId });
    if (conversation) {
      await pushSystemMessage(conversation, {
        senderId: req.user.id,
        content: `🎉 Le candidat a accepté l'embauche pour "${application.offerId.titre}" !`,
        messageType: "hire_response",
        toCandidate: false,
      });
    }

    const offer = application.offerId;
    const recruiter = await Recruiter.findById(offer.recruteurId);
    await Notification.create({
      userId: recruiter.userId,
      message: `Le candidat a accepté l'embauche pour "${offer.titre}" !`,
      type: "validation",
    });

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

    emitApplicationUpdate(recruiter.userId.toString(), {
      _id: application._id,
      recruiterStatus: "embauche",
      offerTitle: offer.titre,
    });

    res.json({
      msg: "Embauche acceptée ! Félicitations !",
      application,
      quotaInfo,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

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
    application.candidateStatus = "en_cours";
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
      await pushSystemMessage(conversation, {
        senderId: req.user.id,
        content: `Le candidat a décliné la proposition d'embauche.${reason ? ` Raison: ${reason}` : ""}`,
        messageType: "hire_response",
        toCandidate: false,
      });
    }

    const offer = application.offerId;
    const recruiter = await Recruiter.findById(offer.recruteurId);
    await Notification.create({
      userId: recruiter.userId,
      message: `Le candidat a décliné l'embauche pour "${offer.titre}"`,
      type: "info",
    });
    emitApplicationUpdate(recruiter.userId.toString(), {
      _id: application._id,
      recruiterStatus: "offer_declined",
    });

    res.json({ msg: "Proposition d'embauche déclinée", application });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/* ═══════════════════ PHASE 7 : NETTOYAGE CANDIDAT ═══════════════════ */

export const getOtherActiveApplications = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });

    const hiredApplication = await Application.findOne({
      candidateId: candidate._id,
      candidateStatus: "embauchee",
    });

    if (!hiredApplication) {
      return res.json({ hasHiredApplication: false, otherApplications: [] });
    }

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
    // Collecte DANS la transaction pour notifier APRÈS sans fenêtre temporelle
    const notifyTargets = [];

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

        // Fermer la conversation liée + message système
        const conv = await Conversation.findOne({
          applicationId: app._id,
        }).session(session);
        if (conv && !conv.isClosed) {
          conv.messages.push({
            senderId: req.user.id,
            senderType: "system",
            content: "Le candidat a retiré sa candidature (embauché ailleurs).",
            messageType: "system",
          });
          conv.isClosed = true;
          conv.closedReason = "application_closed";
          conv.unreadByRecruiter += 1;
          conv.lastMessageAt = new Date();
          await conv.save({ session });
        }

        if (app.offerId?.recruteurId) {
          notifyTargets.push({
            recruiterId: app.offerId.recruteurId,
            offerTitle: app.offerId.titre,
            conversationId: conv?._id,
          });
        }

        withdrawnCount++;
      }

      for (const oid of affectedOfferIds) {
        await syncNombreCandidatures(oid, session);
      }
    });

    // Notifications + socket APRÈS la transaction, sur cibles collectées
    for (const t of notifyTargets) {
      const recruiter = await Recruiter.findById(t.recruiterId);
      if (recruiter) {
        await Notification.create({
          userId: recruiter.userId,
          message: `Le candidat a retiré sa candidature pour "${t.offerTitle}" (embauché ailleurs)`,
          type: "info",
        });
        if (t.conversationId) {
          emitConversationClosed(t.conversationId.toString(), {
            isClosed: true,
            closedBy: "candidate",
            reason: "application_withdrawn",
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

/* ═══════════════════ PHASE 8 : CLÔTURE D'OFFRE ═══════════════════ */

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
    const notifyTargets = [];

    await session.withTransaction(async () => {
      offer.actif = false;
      await offer.save({ session });

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
        })
          .populate("candidateId")
          .session(session);

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

          // Collecte pour notif après transaction
          if (app.candidateId?.userId) {
            notifyTargets.push({
              userId: app.candidateId.userId,
              offerTitle: offer.titre,
              conversationId: conversation?._id,
              candidateUserId: app.candidateId.userId,
              applicationId: app._id,
            });
          }
        }

        rejectedCount = activeApplications.length;
      }

      await syncNombreCandidatures(offer._id, session);
    });

    // Notifications + socket APRÈS transaction
    if (autoReject) {
      for (const t of notifyTargets) {
        await Notification.create({
          userId: t.userId,
          message: `Le poste "${t.offerTitle}" a été pourvu. Votre candidature n'a pas été retenue.`,
          type: "info",
        });
        if (t.conversationId) {
          emitConversationClosed(t.conversationId.toString(), {
            isClosed: true,
            closedBy: "recruiter",
            reason: "offer_closed",
          });
        }
        emitApplicationUpdate(t.candidateUserId.toString(), {
          _id: t.applicationId,
          candidateStatus: "non_retenue",
          offerTitle: t.offerTitle,
        });
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

/* ═══════════════════ PHASE 9 : EMBAUCHES ═══════════════════ */

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
      offer: { _id: app.offerId?._id, titre: app.offerId?.titre },
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
 * removeHire — retrait complet et propre d'une embauche.
 * Ferme la conversation avec message système, resync compteur, socket,
 * annule les interviews résiduels. Retrait DÉFINITIF (pas de ré-embauche).
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
    if (reason) application.rejectionMessage = reason;
    pushStatusHistory(
      application,
      "refusee",
      "non_retenue",
      req.user.id,
      `Embauche retirée: ${reason || "sans raison"}`,
    );
    await application.save();

    // Resync compteur actif
    await syncNombreCandidatures(application.offerId._id);

    // Annuler d'éventuels interviews encore actifs
    await Interview.updateMany(
      {
        applicationId: application._id,
        status: {
          $in: [
            "proposed",
            "confirmed",
            "rescheduled_by_candidate",
            "rescheduled_by_recruiter",
            "pending_feedback",
          ],
        },
      },
      {
        status: "cancelled_by_recruiter",
        cancellationReason: "Embauche retirée",
        cancelledBy: "recruiter",
        cancelledAt: new Date(),
      },
    );

    // Message système + fermeture conversation
    const candidate = await Candidate.findById(application.candidateId);
    const conversation = await Conversation.findOne({ applicationId });
    if (conversation) {
      conversation.messages.push({
        senderId: req.user.id,
        senderType: "system",
        content: `Votre embauche pour "${application.offerId.titre}" a été annulée par le recruteur.${reason ? ` Raison: ${reason}` : ""}`,
        messageType: "closure",
      });
      conversation.isClosed = true;
      conversation.closedReason = "application_closed";
      conversation.unreadByCandidate += 1;
      conversation.lastMessageAt = new Date();
      await conversation.save();

      const lastMsg = conversation.messages[conversation.messages.length - 1];
      emitNewMessage(conversation._id.toString(), lastMsg);
      emitConversationClosed(conversation._id.toString(), {
        isClosed: true,
        closedBy: "recruiter",
        reason: "hire_removed",
      });
    }

    await Notification.create({
      userId: candidate.userId,
      message: `Votre embauche pour "${application.offerId.titre}" a été annulée par le recruteur.`,
      type: "alerte",
    });

    emitApplicationUpdate(candidate.userId.toString(), {
      _id: application._id,
      candidateStatus: "non_retenue",
      offerTitle: application.offerId.titre,
    });

    res.json({ msg: "Embauche retirée", application });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ msg: err.msg });
    res.status(500).json({ msg: err.message });
  }
};

/* ═══════════════════ TÂCHES PLANIFIÉES ═══════════════════ */

export const triggerPendingFeedback = async () => {
  const interviews = await Interview.find({ status: "confirmed" });
  let updatedCount = 0;

  for (const interview of interviews) {
    if (interview.isFeedbackDue()) {
      interview.status = "pending_feedback";
      await interview.save();

      const application = await Application.findById(interview.applicationId);
      if (application && application.recruiterStatus === "entretien_planifie") {
        application.recruiterStatus = "pending_feedback";
        application.candidateStatus =
          mapRecruiterToCandidate("pending_feedback");
        application.statusHistory.push({
          candidateStatus: application.candidateStatus,
          recruiterStatus: "pending_feedback",
          changedBy: null,
          note: `Feedback requis pour l'entretien #${interview.interviewNumber}`,
        });
        await application.save();
      }

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
    if (interview.candidateId?.userId) {
      await Notification.create({
        userId: interview.candidateId.userId,
        message: `Rappel : vous avez un entretien demain`,
        type: "info",
      });
    }
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

export const deleteOrphanedConversation = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);
    const { conversationId } = req.params;

    const conversation = await Conversation.findOne({
      _id: conversationId,
      recruiterId: recruiter._id,
    });

    if (!conversation) {
      return res.status(404).json({ msg: "Conversation introuvable" });
    }

    if (!conversation.candidateDeleted) {
      return res.status(400).json({
        msg: "Seules les conversations liées à un candidat supprimé peuvent être supprimées.",
      });
    }

    await Interview.deleteMany({ conversationId: conversation._id });
    await Conversation.deleteOne({ _id: conversation._id });

    res.json({ msg: "Conversation supprimée de votre historique." });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ msg: err.msg });
    res.status(500).json({ msg: err.message });
  }
};
