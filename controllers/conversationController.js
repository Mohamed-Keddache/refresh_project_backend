import Conversation from "../models/Conversation.js";
import Application from "../models/Application.js";
import Offer from "../models/Offer.js";
import Candidate from "../models/Candidate.js";
import Recruiter from "../models/Recruiter.js";
import Notification from "../models/Notification.js";
import { mapRecruiterToCandidate } from "../utils/statusMapping.js";
import { saveFiles } from "../services/fileService.js";
import Interview from "../models/Interview.js";
import {
  emitNewMessage,
  emitConversationUpdate,
  emitUnreadCount,
  emitConversationClosed,
} from "../services/socketEvents.js";

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

    let conversation = await Conversation.findOne({ applicationId });

    if (conversation) {
      return res.status(400).json({
        msg: "Une conversation existe déjà pour cette candidature",
        conversationId: conversation._id,
      });
    }

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

    if (initialMessage) {
      const candidate = await Candidate.findById(application.candidateId);

      const newMsg = conversation.messages[conversation.messages.length - 1];
      emitNewMessage(conversation._id.toString(), newMsg, {
        applicationId: applicationId,
      });

      emitConversationUpdate(candidate.userId.toString(), {
        _id: conversation._id,
        applicationId,
        lastMessage: newMsg,
        unreadCount: 1,
        lastMessageAt: new Date(),
      });

      emitUnreadCount(candidate.userId.toString(), {
        conversations: 1,
      });

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

export const sendMessageAsRecruiter = async (req, res) => {
  try {
    const recruiter = await Recruiter.findOne({ userId: req.user.id });
    const { conversationId } = req.params;
    const { content } = req.body;
    const attachments = await saveFiles(req.files, "attachments");

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

    if (conversation.isClosed) {
      conversation.isClosed = false;
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

    const newMsg = conversation.messages[conversation.messages.length - 1];

    emitNewMessage(conversationId, newMsg);

    const candidate = await Candidate.findById(conversation.candidateId);

    emitConversationUpdate(candidate.userId.toString(), {
      _id: conversation._id,
      lastMessage: newMsg,
      unreadCount: conversation.unreadByCandidate,
      lastMessageAt: conversation.lastMessageAt,
    });

    emitUnreadCount(candidate.userId.toString(), {
      conversations: conversation.unreadByCandidate,
    });

    await Notification.create({
      userId: candidate.userId,
      message: `Nouveau message du recruteur`,
      type: "info",
    });

    res.json({
      msg: "Message envoyé",
      message: newMsg,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getRecruiterConversations = async (req, res) => {
  try {
    const recruiter = await Recruiter.findOne({ userId: req.user.id });
    const { offerId, hasUnread, isActive, page = 1, limit = 20 } = req.query;

    let query = { recruiterId: recruiter._id, status: "active" };

    if (offerId) query.offerId = offerId;
    if (hasUnread === "true") query.unreadByRecruiter = { $gt: 0 };
    if (isActive === "true") query.candidateHasReplied = true;
    if (isActive === "false") query.candidateHasReplied = false;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [conversations, total] = await Promise.all([
      Conversation.find(query)
        .sort({ lastMessageAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate({
          path: "candidateId",
          select: "profilePicture userId",
          populate: { path: "userId", select: "nom" },
        })
        .populate("offerId", "titre")
        .lean(),
      Conversation.countDocuments(query),
    ]);

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
      isClosed: c.isClosed,
    }));

    res.json({
      data: enriched,
      meta: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getCandidateConversations = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = {
      candidateId: candidate._id,
      status: "active",
    };

    const [conversations, total] = await Promise.all([
      Conversation.find(query)
        .sort({ lastMessageAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate("offerId", "titre companyId")
        .populate({
          path: "offerId",
          populate: { path: "companyId", select: "name logo" },
        })
        .lean(),
      Conversation.countDocuments(query),
    ]);

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
      isClosed: c.isClosed,
    }));

    res.json({
      data: enriched,
      meta: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// ══════════════════════════════════════════════════════════════
// BUG 6 FIX: Pagination par curseur pour les messages (candidat).
// - Par défaut: retourne les 30 derniers messages.
// - Avec `before=<messageId>`: retourne les 30 messages précédents.
// - Retourne `hasMore` pour le chargement à l'infini (scroll up).
// ══════════════════════════════════════════════════════════════
export const getConversationMessages = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    const { conversationId } = req.params;
    const { before, limit: queryLimit } = req.query;
    const pageSize = Math.min(parseInt(queryLimit) || 30, 50);

    // ✅ D'abord vérifier l'accès et obtenir les métadonnées
    const conversation = await Conversation.findOne({
      _id: conversationId,
      candidateId: candidate._id,
    })
      .select(
        "applicationId offerId status isClosed unreadByCandidate messages",
      )
      .populate({
        path: "offerId",
        select: "titre companyId",
        populate: { path: "companyId", select: "name logo" },
      })
      .populate("messages.metadata.interviewId");

    if (!conversation) {
      return res.status(404).json({ msg: "Conversation introuvable" });
    }

    const allMessages = conversation.messages || [];
    const totalMessages = allMessages.length;

    // ✅ Pagination par curseur (messageId) au lieu d'index
    let paginatedMessages;
    let hasMore;

    if (before) {
      const beforeIndex = allMessages.findIndex(
        (m) => m._id.toString() === before,
      );
      if (beforeIndex > 0) {
        const startIndex = Math.max(0, beforeIndex - pageSize);
        paginatedMessages = allMessages.slice(startIndex, beforeIndex);
        hasMore = startIndex > 0;
      } else {
        paginatedMessages = [];
        hasMore = false;
      }
    } else {
      const startIndex = Math.max(0, totalMessages - pageSize);
      paginatedMessages = allMessages.slice(startIndex);
      hasMore = startIndex > 0;
    }

    // ✅ Marquer comme lu en parallèle (non bloquant)
    const prevUnread = conversation.unreadByCandidate || 0;

    // Opérations de mise à jour en parallèle
    const updateOps = [
      Conversation.findByIdAndUpdate(conversationId, { unreadByCandidate: 0 }),
      Conversation.updateOne(
        { _id: conversationId },
        { $set: { "messages.$[elem].readAt": new Date() } },
        {
          arrayFilters: [
            {
              "elem.readAt": { $exists: false },
              "elem.senderType": "recruiter",
            },
          ],
        },
      ),
    ];

    await Promise.all(updateOps); // ✅ Parallèle au lieu de séquentiel

    // Émettre le Socket event en arrière-plan
    if (prevUnread > 0) {
      Conversation.findById(conversationId)
        .select("recruiterId")
        .populate("recruiterId", "userId")
        .then((conv) => {
          if (conv?.recruiterId?.userId) {
            emitUnreadCount(conv.recruiterId.userId.toString(), {
              conversationId,
              unreadByCandidate: 0,
            });
          }
        })
        .catch(() => {}); // non-bloquant
    }

    res.json({
      _id: conversation._id,
      applicationId: conversation.applicationId,
      status: conversation.status,
      isClosed: conversation.isClosed,
      context: {
        offerId: conversation.offerId?._id,
        offerTitle: conversation.offerId?.titre || "Offre supprimée",
        companyName:
          conversation.offerId?.companyId?.name || "Entreprise inconnue",
        companyLogo: conversation.offerId?.companyId?.logo,
      },
      messages: paginatedMessages,
      meta: { totalMessages, returned: paginatedMessages.length, hasMore },
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const sendMessageAsCandidate = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    const { conversationId } = req.params;
    const { content } = req.body;
    const attachments = await saveFiles(req.files, "attachments");

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

    if (conversation.isClosed) {
      return res
        .status(403)
        .json({ msg: "Cette conversation a été fermée par le recruteur." });
    }

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

    const newMsg = conversation.messages[conversation.messages.length - 1];

    emitNewMessage(conversationId, newMsg);

    const recruiter = await Recruiter.findById(conversation.recruiterId);

    emitConversationUpdate(recruiter.userId.toString(), {
      _id: conversation._id,
      lastMessage: newMsg,
      unreadCount: conversation.unreadByRecruiter,
      lastMessageAt: conversation.lastMessageAt,
      candidateHasReplied: true,
    });

    emitUnreadCount(recruiter.userId.toString(), {
      conversations: conversation.unreadByRecruiter,
    });

    await Notification.create({
      userId: recruiter.userId,
      message: `Nouvelle réponse d'un candidat`,
      type: "info",
    });

    res.json({
      msg: "Message envoyé",
      message: newMsg,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// ══════════════════════════════════════════════════════════════
// BUG 6 FIX: Pagination par curseur pour les messages (recruteur).
// ══════════════════════════════════════════════════════════════
export const getRecruiterConversationMessages = async (req, res) => {
  try {
    const recruiter = await Recruiter.findOne({ userId: req.user.id });
    const { conversationId } = req.params;
    const { before, limit: queryLimit } = req.query;
    const pageSize = Math.min(parseInt(queryLimit) || 30, 50);

    const conversation = await Conversation.findOne({
      _id: conversationId,
      recruiterId: recruiter._id,
    })
      .populate("candidateId", "profilePicture")
      .populate({
        path: "candidateId",
        populate: { path: "userId", select: "nom" },
      })
      .populate("offerId", "titre")
      .populate("messages.metadata.interviewId");

    if (!conversation) {
      return res.status(404).json({ msg: "Conversation introuvable" });
    }

    // Pagination par curseur
    const allMessages = conversation.messages || [];
    const totalMessages = allMessages.length;
    let paginatedMessages;
    let hasMore;

    if (before) {
      const beforeIndex = allMessages.findIndex(
        (m) => m._id.toString() === before,
      );
      if (beforeIndex > 0) {
        const startIndex = Math.max(0, beforeIndex - pageSize);
        paginatedMessages = allMessages.slice(startIndex, beforeIndex);
        hasMore = startIndex > 0;
      } else {
        paginatedMessages = [];
        hasMore = false;
      }
    } else {
      const startIndex = Math.max(0, totalMessages - pageSize);
      paginatedMessages = allMessages.slice(startIndex);
      hasMore = startIndex > 0;
    }

    const prevUnread = conversation.unreadByRecruiter || 0;

    await Conversation.findByIdAndUpdate(conversationId, {
      unreadByRecruiter: 0,
    });

    if (prevUnread > 0) {
      const candidateDoc = await Candidate.findById(
        conversation.candidateId?._id,
      );
      if (candidateDoc?.userId) {
        emitUnreadCount(candidateDoc.userId.toString(), {
          conversationId,
          unreadByRecruiter: 0,
        });
      }
    }

    res.json({
      _id: conversation._id,
      applicationId: conversation.applicationId,
      candidateId: conversation.candidateId?._id,
      offer: { titre: conversation.offerId?.titre },
      candidate: {
        nom: conversation.candidateId?.userId?.nom,
        profilePicture: conversation.candidateId?.profilePicture,
      },
      messages: paginatedMessages,
      status: conversation.status,
      isClosed: conversation.isClosed,
      meta: {
        totalMessages,
        returned: paginatedMessages.length,
        hasMore,
      },
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const toggleChatStatus = async (req, res) => {
  try {
    const recruiter = await Recruiter.findOne({ userId: req.user.id });
    const { conversationId } = req.params;
    const { isClosed } = req.body;

    const conversation = await Conversation.findOne({
      _id: conversationId,
      recruiterId: recruiter._id,
    });

    if (!conversation) {
      return res.status(404).json({ msg: "Conversation introuvable" });
    }

    conversation.isClosed = isClosed;
    await conversation.save();

    if (isClosed) {
      emitConversationClosed(conversationId, {
        isClosed: true,
        closedBy: "recruiter",
      });
    }

    res.json({
      msg: isClosed ? "Conversation fermée" : "Conversation ouverte",
      isClosed: conversation.isClosed,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// ══════════════════════════════════════════════════════════════
// FEATURE 2.7: Total des conversations non-lues (badge header)
// ══════════════════════════════════════════════════════════════
export const getCandidateUnreadTotal = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    if (!candidate) {
      return res.json({ totalUnread: 0 });
    }

    const result = await Conversation.aggregate([
      {
        $match: {
          candidateId: candidate._id,
          status: "active",
          unreadByCandidate: { $gt: 0 },
        },
      },
      {
        $group: {
          _id: null,
          totalUnread: { $sum: "$unreadByCandidate" },
          conversationsWithUnread: { $sum: 1 },
        },
      },
    ]);

    const data = result[0] || {
      totalUnread: 0,
      conversationsWithUnread: 0,
    };

    res.json({
      totalUnread: data.totalUnread,
      conversationsWithUnread: data.conversationsWithUnread,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};
