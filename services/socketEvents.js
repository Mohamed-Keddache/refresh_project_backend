import { getIO } from "../config/socket.js";

const safeGetIO = () => {
  try {
    return getIO();
  } catch {
    return null;
  }
};

/* ─────────────── NOTIFICATIONS ─────────────── */

export const emitNotification = (userId, notification) => {
  const io = safeGetIO();
  if (!io) return;
  io.to(`user:${userId}`).emit("notification:new", {
    _id: notification._id,
    message: notification.message,
    type: notification.type,
    date: notification.date || new Date(),
    lu: false,
  });
};

export const emitNotificationCount = async (userId) => {
  const io = safeGetIO();
  if (!io) return;
  const Notification = (await import("../models/Notification.js")).default;
  const count = await Notification.countDocuments({ userId, lu: false });
  io.to(`user:${userId}`).emit("notification:count", { count });
};

/* ─────────────── MESSAGES ─────────────── */
// Payload TOUJOURS normalisé : { conversationId, message, ...meta }

export const emitNewMessage = (conversationId, message, meta = {}) => {
  const io = safeGetIO();
  if (!io) return;
  io.to(`conversation:${conversationId}`).emit("message:new", {
    conversationId,
    message,
    ...meta,
  });
};

export const emitConversationUpdate = (userId, conversationSummary) => {
  const io = safeGetIO();
  if (!io) return;
  io.to(`user:${userId}`).emit("conversation:updated", conversationSummary);
};

export const emitUnreadCount = (userId, counts) => {
  const io = safeGetIO();
  if (!io) return;
  io.to(`user:${userId}`).emit("unread:updated", counts);
};

export const emitConversationClosed = (conversationId, data) => {
  const io = safeGetIO();
  if (!io) return;
  io.to(`conversation:${conversationId}`).emit("conversation:closed", {
    conversationId,
    ...data,
  });
};

export const emitConversationReopened = (conversationId, data = {}) => {
  const io = safeGetIO();
  if (!io) return;
  io.to(`conversation:${conversationId}`).emit("conversation:reopened", {
    conversationId,
    ...data,
  });
};

/* ─────────────── INTERVIEWS ─────────────── */
// Deux canaux :
//  - user:${userId}         → pour les dashboards (listes)
//  - conversation:${convId} → pour patcher la carte dans le chat en direct

export const emitInterviewUpdate = (userId, interview) => {
  const io = safeGetIO();
  if (!io) return;
  io.to(`user:${userId}`).emit("interview:updated", interview);
};

export const emitInterviewNew = (userId, interview) => {
  const io = safeGetIO();
  if (!io) return;
  io.to(`user:${userId}`).emit("interview:new", interview);
};

// Patch de la carte d'entretien dans une conversation (les deux participants)
export const emitInterviewCardUpdate = (conversationId, interview) => {
  const io = safeGetIO();
  if (!io) return;
  io.to(`conversation:${conversationId}`).emit("interview:card_update", {
    conversationId,
    interview,
  });
};

/* ─────────────── APPLICATIONS ─────────────── */

export const emitApplicationUpdate = (userId, application) => {
  const io = safeGetIO();
  if (!io) return;
  io.to(`user:${userId}`).emit("application:updated", application);
};

export const emitApplicationNew = (recruiterId, application) => {
  const io = safeGetIO();
  if (!io) return;
  io.to(`user:${recruiterId}`).emit("application:new", application);
};

/* ─────────────── TYPING (symétrique) ─────────────── */
// Déjà relayé nativement par config/socket.js (typing:start / typing:stop).
// Pas d'émission serveur supplémentaire nécessaire.

/* ─────────────── ADMIN ─────────────── */

export const emitAdminEvent = (eventName, data) => {
  const io = safeGetIO();
  if (!io) return;
  io.to("admins").emit(eventName, data);
};

export default {
  emitNotification,
  emitNotificationCount,
  emitNewMessage,
  emitConversationUpdate,
  emitUnreadCount,
  emitConversationClosed,
  emitConversationReopened,
  emitInterviewUpdate,
  emitInterviewNew,
  emitInterviewCardUpdate,
  emitApplicationUpdate,
  emitApplicationNew,
  emitAdminEvent,
};
