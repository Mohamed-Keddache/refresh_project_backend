import { getIO } from "../config/socket.js";

// Safely get IO — returns null if not initialized (e.g., during tests)
const safeGetIO = () => {
  try {
    return getIO();
  } catch {
    return null;
  }
};

// ─── Notifications ───

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

  // We import dynamically to avoid circular dependencies
  const Notification = (await import("../models/Notification.js")).default;
  const count = await Notification.countDocuments({ userId, lu: false });

  io.to(`user:${userId}`).emit("notification:count", { count });
};

// ─── Conversations / Messages ───

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

  io.to(`conversation:${conversationId}`).emit("conversation:closed", data);
};

// ─── Interviews ───

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

// ─── Applications ───

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

// ─── Admin-specific ───

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
  emitInterviewUpdate,
  emitInterviewNew,
  emitApplicationUpdate,
  emitApplicationNew,
  emitAdminEvent,
};
