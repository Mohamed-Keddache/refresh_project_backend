import { Server } from "socket.io";
import jwt from "jsonwebtoken";

let io = null;

export const initializeSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    pingInterval: 25000,
    pingTimeout: 60000,
    transports: ["websocket", "polling"],
  });

  // Authenticate every socket connection using your existing JWT
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;

    if (!token) {
      return next(new Error("Authentication required"));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded; // { id, role, emailVerified }
      next();
    } catch (err) {
      return next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.user.id;
    const userRole = socket.user.role;

    // Every user joins a personal room: "user:<userId>"
    // This is how we target notifications and messages to specific people.
    socket.join(`user:${userId}`);

    // Admins join a shared admin room for broadcast admin events
    if (userRole === "admin") {
      socket.join("admins");
    }

    console.log(`🔌 Socket connected: ${userId} (${userRole}) [${socket.id}]`);

    // When a user opens a specific conversation, they join that room
    // so we can push messages in real time to both participants.
    socket.on("join:conversation", (conversationId) => {
      socket.join(`conversation:${conversationId}`);
    });

    socket.on("leave:conversation", (conversationId) => {
      socket.leave(`conversation:${conversationId}`);
    });

    // When a user is viewing a specific application's details
    socket.on("join:application", (applicationId) => {
      socket.join(`application:${applicationId}`);
    });

    socket.on("leave:application", (applicationId) => {
      socket.leave(`application:${applicationId}`);
    });

    // Typing indicators — relayed to the conversation room
    socket.on("typing:start", ({ conversationId }) => {
      socket.to(`conversation:${conversationId}`).emit("typing:start", {
        userId,
        conversationId,
      });
    });

    socket.on("typing:stop", ({ conversationId }) => {
      socket.to(`conversation:${conversationId}`).emit("typing:stop", {
        userId,
        conversationId,
      });
    });

    // Mark messages as read in real time
    socket.on("messages:read", ({ conversationId }) => {
      socket.to(`conversation:${conversationId}`).emit("messages:read", {
        userId,
        conversationId,
        readAt: new Date(),
      });
    });

    socket.on("disconnect", (reason) => {
      console.log(`🔌 Socket disconnected: ${userId} (${reason})`);
    });
  });

  return io;
};

export const getIO = () => {
  if (!io) {
    throw new Error("Socket.IO not initialized. Call initializeSocket first.");
  }
  return io;
};

export default { initializeSocket, getIO };
