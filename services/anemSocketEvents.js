// services/anemSocketEvents.js
import { getIO } from "../config/socket.js";

const safeGetIO = () => {
  try {
    return getIO();
  } catch {
    return null;
  }
};

// Emit ANEM offer pipeline update to a specific recruiter user room
export const emitAnemOfferUpdate = (recruiterUserId, payload) => {
  const io = safeGetIO();
  if (!io || !recruiterUserId) return;
  io.to(`user:${recruiterUserId}`).emit("anem_offer:updated", payload);
};

// Broadcast ANEM offer changes to all admins (so admin dashboards refresh live)
export const emitAnemOfferAdminUpdate = (payload) => {
  const io = safeGetIO();
  if (!io) return;
  io.to("admins").emit("anem_offer:admin_updated", payload);
};

// Emit ANEM registration status update to a recruiter/candidate user room
export const emitAnemRegistrationUpdate = (userId, payload) => {
  const io = safeGetIO();
  if (!io || !userId) return;
  io.to(`user:${userId}`).emit("anem_registration:updated", payload);
};

export default {
  emitAnemOfferUpdate,
  emitAnemOfferAdminUpdate,
  emitAnemRegistrationUpdate,
};
