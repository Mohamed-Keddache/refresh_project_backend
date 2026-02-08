// controllers/conversationController.js
import Conversation from "../models/Conversation.js";
import Application from "../models/Application.js";
import Offer from "../models/Offer.js";
import Candidate from "../models/Candidate.js";
import Recruiter from "../models/Recruiter.js";
import Notification from "../models/Notification.js";
import { mapRecruiterToCandidate } from "../utils/statusMapping.js";

// === RECRUTEUR ===

// Ouvrir une conversation (recruteur uniquement)
export const openConversation = async (req, res) => {
  try {
    const recruiter = await Recruiter.findOne({ userId: req.user.id });
    const { applicationId } = req.params;
    const { initialMessage } = req.body;

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

    // Vérifier si conversation existe déjà
    let conversation = await Conversation.findOne({ applicationId });

    if (conversation) {
      return res.status(400).json({
        msg: "Une conversation existe déjà pour cette candidature",
        conversationId: conversation._id,
      });
    }

    // Créer la conversation
    conversation = await Conversation.create({
      applicationId,
      offerId: application.offerId._id,
      candidateId: application.candidateId,
      recruiterId: recruiter._id,
      openedBy: req.user.id,
      messages: initialMessage
        ? [
            {
              senderId: req.user.id,
              senderType: "recruiter",
              content: initialMessage,
            },
          ]
        : [],
      unreadByCandidate: initialMessage ? 1 : 0,
      lastMessageAt: initialMessage ? new Date() : null,
    });

    // Mettre à jour le statut si nécessaire
    if (
      application.recruiterStatus !== "en_discussion" &&
      ![
        "entretien_planifie",
        "entretien_termine",
        "retenue",
        "refusee",
      ].includes(application.recruiterStatus)
    ) {
      application.recruiterStatus = "en_discussion";
      application.candidateStatus = mapRecruiterToCandidate("en_discussion");
      application.statusHistory.push({
        candidateStatus: application.candidateStatus,
        recruiterStatus: "en_discussion",
        changedBy: req.user.id,
        note: "Conversation ouverte",
      });
      await application.save();
    }

    // Notifier le candidat
    if (initialMessage) {
      const candidate = await Candidate.findById(application.candidateId);
      await Notification.create({
        userId: candidate.userId,
        message: `Nouveau message du recruteur pour "${application.offerId.titre}"`,
        type: "info",
      });
    }

    res.status(201).json({ msg: "Conversation ouverte", conversation });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// Envoyer un message (recruteur)
export const sendMessageAsRecruiter = async (req, res) => {
  try {
    const recruiter = await Recruiter.findOne({ userId: req.user.id });
    const { conversationId } = req.params;
    const { content } = req.body;
    const attachments = req.files?.map((f) => f.path.replace(/\\/g, "/")) || [];

    const conversation = await Conversation.findOne({
      _id: conversationId,
      recruiterId: recruiter._id,
      status: "active",
    });

    if (!conversation) {
      return res
        .status(404)
        .json({ msg: "Conversation introuvable ou fermée" });
    }

    conversation.messages.push({
      senderId: req.user.id,
      senderType: "recruiter",
      content,
      attachments,
    });
    conversation.unreadByCandidate += 1;
    conversation.lastMessageAt = new Date();
    await conversation.save();

    // Notifier
    const candidate = await Candidate.findById(conversation.candidateId);
    await Notification.create({
      userId: candidate.userId,
      message: `Nouveau message du recruteur`,
      type: "info",
    });

    res.json({
      msg: "Message envoyé",
      message: conversation.messages.slice(-1)[0],
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// Conversations du recruteur
export const getRecruiterConversations = async (req, res) => {
  try {
    const recruiter = await Recruiter.findOne({ userId: req.user.id });
    const { offerId, hasUnread, isActive } = req.query;

    let query = { recruiterId: recruiter._id, status: "active" };

    if (offerId) query.offerId = offerId;
    if (hasUnread === "true") query.unreadByRecruiter = { $gt: 0 };

    // NOUVEAU : filtrer par conversations actives (candidat a répondu)
    if (isActive === "true") query.candidateHasReplied = true;
    if (isActive === "false") query.candidateHasReplied = false;

    const conversations = await Conversation.find(query)
      .sort({ lastMessageAt: -1 })
      .populate({
        path: "candidateId",
        select: "profilePicture userId",
        populate: { path: "userId", select: "nom" },
      })
      .populate("offerId", "titre")
      .lean();

    const enriched = conversations.map((c) => ({
      _id: c._id,
      applicationId: c.applicationId,
      offer: { _id: c.offerId?._id, titre: c.offerId?.titre },
      candidate: {
        nom: c.candidateId?.userId?.nom,
        profilePicture: c.candidateId?.profilePicture,
      },
      lastMessage: c.messages?.slice(-1)[0],
      unreadCount: c.unreadByRecruiter,
      lastMessageAt: c.lastMessageAt,
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// === CANDIDAT ===

// Mes conversations
export const getCandidateConversations = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });

    const conversations = await Conversation.find({
      candidateId: candidate._id,
      status: "active",
    })
      .sort({ lastMessageAt: -1 })
      .populate("offerId", "titre companyId")
      .populate({
        path: "offerId",
        populate: { path: "companyId", select: "name logo" },
      })
      .lean();

    const enriched = conversations.map((c) => ({
      _id: c._id,
      applicationId: c.applicationId,
      offer: {
        titre: c.offerId?.titre,
        entreprise: c.offerId?.companyId?.name,
        logo: c.offerId?.companyId?.logo,
      },
      lastMessage: c.messages?.slice(-1)[0],
      unreadCount: c.unreadByCandidate,
      lastMessageAt: c.lastMessageAt,
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// Messages d'une conversation (candidat)
export const getConversationMessages = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    const { conversationId } = req.params;

    // 1. Fetch conversation with deeply populated Company info
    const conversation = await Conversation.findOne({
      _id: conversationId,
      candidateId: candidate._id,
    })
      .populate({
        path: "offerId",
        select: "titre companyId",
        populate: {
          path: "companyId",
          select: "name logo", // CRITICAL: Need name and logo for the chat header
        },
      })
      .lean();

    if (!conversation) {
      return res.status(404).json({ msg: "Conversation introuvable" });
    }

    // 2. Mark as read
    await Conversation.findByIdAndUpdate(conversationId, {
      unreadByCandidate: 0,
    });

    // 3. Mark specific messages as read
    await Conversation.updateOne(
      { _id: conversationId },
      { $set: { "messages.$[elem].readAt": new Date() } },
      {
        arrayFilters: [
          { "elem.readAt": { $exists: false }, "elem.senderType": "recruiter" },
        ],
      },
    );

    // 4. Return enriched response
    res.json({
      _id: conversation._id,
      applicationId: conversation.applicationId,
      status: conversation.status,
      // Enhanced Context for the Header
      context: {
        offerId: conversation.offerId?._id,
        offerTitle: conversation.offerId?.titre || "Offre supprimée",
        companyName:
          conversation.offerId?.companyId?.name || "Entreprise inconnue",
        companyLogo: conversation.offerId?.companyId?.logo,
      },
      messages: conversation.messages,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// Répondre (candidat)
export const sendMessageAsCandidate = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    const { conversationId } = req.params;
    const { content } = req.body;
    const attachments = req.files?.map((f) => f.path.replace(/\\/g, "/")) || [];

    const conversation = await Conversation.findOne({
      _id: conversationId,
      candidateId: candidate._id,
      status: "active",
    });

    if (!conversation) {
      return res
        .status(404)
        .json({ msg: "Conversation introuvable ou fermée" });
    }

    // Marquer que le candidat a répondu
    if (!conversation.candidateHasReplied) {
      conversation.candidateHasReplied = true;
      conversation.firstCandidateReplyAt = new Date();
    }

    conversation.messages.push({
      senderId: req.user.id,
      senderType: "candidate",
      content,
      attachments,
    });
    conversation.unreadByRecruiter += 1;
    conversation.lastMessageAt = new Date();
    await conversation.save();

    // Notifier recruteur
    const recruiter = await Recruiter.findById(conversation.recruiterId);
    await Notification.create({
      userId: recruiter.userId,
      message: `Nouvelle réponse d'un candidat`,
      type: "info",
    });

    res.json({
      msg: "Message envoyé",
      message: conversation.messages.slice(-1)[0],
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};
export const getRecruiterConversationMessages = async (req, res) => {
  try {
    const recruiter = await Recruiter.findOne({ userId: req.user.id });
    const { conversationId } = req.params;

    const conversation = await Conversation.findOne({
      _id: conversationId,
      recruiterId: recruiter._id, // Sécurité : on vérifie que c'est bien son chat
    })
      .populate("candidateId", "profilePicture")
      .populate({
        path: "candidateId",
        populate: { path: "userId", select: "nom" },
      })
      .populate("offerId", "titre")
      .lean();

    if (!conversation) {
      return res.status(404).json({ msg: "Conversation introuvable" });
    }

    // Marquer comme lu
    await Conversation.findByIdAndUpdate(conversationId, {
      unreadByRecruiter: 0,
    });

    res.json({
      _id: conversation._id,
      applicationId: conversation.applicationId,
      candidateId: conversation.candidateId?._id,
      offer: { titre: conversation.offerId?.titre },
      candidate: {
        nom: conversation.candidateId?.userId?.nom,
        profilePicture: conversation.candidateId?.profilePicture,
      },
      messages: conversation.messages,
      status: conversation.status,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};
