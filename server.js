import "dotenv/config";
import express from "express";
import http from "http"; // ← NEW
import cors from "cors";
import morgan from "morgan";
import passport from "passport";
import connectDB from "./config/db.js";
import setupFolders from "./startup/setupFolders.js";
import { seedAdmin } from "./startup/seedAdmin.js";
import { setupSecurity } from "./middleware/security.js";
import SystemSettings from "./models/SystemSettings.js";
import { verifySmtpConnection } from "./services/emailService.js";
import { initializeSocket } from "./config/socket.js"; // ← NEW

import "./config/passport.js";

import authRoutes from "./routes/authRoutes.js";
import candidateRoutes from "./routes/candidateRoutes.js";
import offerRoutes from "./routes/offerRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import skillRoutes from "./routes/skillRoutes.js";
import supportRoutes from "./routes/supportRoutes.js";
import announcementRoutes from "./routes/announcementRoutes.js";

import recruiterRoutes from "./routes/recruiterRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import anemRoutes from "./routes/anemRoutes.js";
import candidateAnemRoutes from "./routes/candidateAnemRoutes.js";
import recruitmentRoutes from "./routes/recruitmentRoutes.js";

const app = express();
const server = http.createServer(app); // ← NEW: explicit HTTP server

// Initialize Socket.IO ← NEW
const io = initializeSocket(server);
console.log("🔌 Socket.IO initialized");

try {
  setupSecurity(app);
} catch (err) {
  console.warn("⚠️ setupSecurity not found or failed, skipping...");
}

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "ngrok-skip-browser-warning",
    ],
  }),
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use(passport.initialize());

if (process.env.NODE_ENV !== "test") {
  app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
}

app.use("/uploads", express.static("uploads"));

async function startServer() {
  try {
    console.log("🔧 Environment check:");
    console.log("   NODE_ENV:", process.env.NODE_ENV || "development");
    console.log("   SMTP_HOST:", process.env.SMTP_HOST || "NOT SET");
    console.log("   SMTP_PORT:", process.env.SMTP_PORT || "NOT SET");
    console.log("   SMTP_USER:", process.env.SMTP_USER || "NOT SET");
    console.log("   SMTP_PASS:", process.env.SMTP_PASS ? "SET" : "NOT SET");

    console.log(
      "   GOOGLE_CLIENT_ID:",
      process.env.GOOGLE_CLIENT_ID ? "SET" : "NOT SET",
    );
    console.log(
      "   FACEBOOK_APP_ID:",
      process.env.FACEBOOK_APP_ID ? "SET" : "NOT SET",
    );

    await connectDB();
    setupFolders();

    await seedAdmin();

    await SystemSettings.initializeDefaults();
    console.log("⚙️ Paramètres système initialisés");

    const emailMode = await SystemSettings.getSetting(
      "email_verification_mode",
      "development",
    );
    console.log(`📧 Email verification mode: ${emailMode}`);

    if (emailMode === "smtp") {
      console.log("📧 Verifying SMTP connection...");
      const smtpOk = await verifySmtpConnection();
      if (smtpOk) {
        console.log("✅ SMTP ready for sending emails");
      } else {
        console.warn("⚠️ SMTP connection failed - emails may not be sent");
        console.warn("   Falling back to development mode for safety");
      }
    } else {
      console.log("📧 Development mode: Use code 123456 for verification");
    }

    app.use("/api/auth", authRoutes);
    app.use("/api/skills", skillRoutes);
    app.use("/api/offers", offerRoutes);
    app.use("/api/candidates", candidateRoutes);
    app.use("/api/notifications", notificationRoutes);
    app.use("/api/support", supportRoutes);
    app.use("/api/announcements", announcementRoutes);
    app.use("/api/candidate-anem", candidateAnemRoutes);

    app.use("/api/recruiters", recruiterRoutes);
    app.use("/api/admin", adminRoutes);
    app.use("/api/anem", anemRoutes);
    app.use("/api/recruitment", recruitmentRoutes);

    app.get("/", (req, res) =>
      res.json({
        status: "ok",
        message: "✅ API Recrutement opérationnelle !",
        timestamp: new Date().toISOString(),
      }),
    );

    app.get("/health", (req, res) =>
      res.json({
        status: "healthy",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        socketConnections: io.engine.clientsCount,
      }),
    );

    if (process.env.NODE_ENV !== "production") {
      app.get("/debug/smtp", async (req, res) => {
        try {
          const smtpOk = await verifySmtpConnection();
          const emailMode = await SystemSettings.getSetting(
            "email_verification_mode",
            "development",
          );
          res.json({
            smtpConnection: smtpOk,
            emailMode,
            config: {
              host: process.env.SMTP_HOST,
              port: process.env.SMTP_PORT,
              user: process.env.SMTP_USER,
              passSet: !!process.env.SMTP_PASS,
            },
          });
        } catch (err) {
          res.status(500).json({ error: err.message });
        }
      });

      app.get("/debug/sockets", (req, res) => {
        const sockets = [];
        for (const [id, socket] of io.sockets.sockets) {
          sockets.push({
            id,
            userId: socket.user?.id,
            role: socket.user?.role,
            rooms: [...socket.rooms],
          });
        }
        res.json({
          totalConnections: io.engine.clientsCount,
          sockets,
        });
      });
    }

    app.use((req, res) => {
      res.status(404).json({ msg: "Route non trouvée" });
    });

    app.use((err, req, res, next) => {
      console.error("❌ Erreur serveur:", err);

      if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
        return res.status(400).json({ msg: "JSON invalide" });
      }

      const message =
        process.env.NODE_ENV === "production"
          ? "Erreur interne du serveur"
          : err.message;

      res.status(err.status || 500).json({
        msg: message,
        ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
      });
    });

    startScheduledTasks();

    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => {
      console.log(`🚀 Serveur lancé sur le port ${PORT}`);
      console.log(`🔌 Socket.IO ready on same port`);
      console.log(`📊 Environnement: ${process.env.NODE_ENV || "development"}`);
    });
  } catch (error) {
    console.error("❌ Erreur lors du démarrage du serveur :", error);
    process.exit(1);
  }
}

startServer();

function startScheduledTasks() {
  console.log("⏰ Starting scheduled tasks...");

  const runScheduledTasks = async () => {
    try {
      // 1. Trigger pending feedback
      const { triggerPendingFeedback } =
        await import("./controllers/recruitmentFlowController.js");
      const feedbackCount = await triggerPendingFeedback();
      if (feedbackCount > 0) {
        console.log(
          `⏰ triggerPendingFeedback: ${feedbackCount} interview(s) updated`,
        );
      }

      // 2. Send reminders
      const { sendInterviewReminders } =
        await import("./controllers/recruitmentFlowController.js");
      const reminderCount = await sendInterviewReminders();
      if (reminderCount > 0) {
        console.log(
          `⏰ sendInterviewReminders: ${reminderCount} reminder(s) sent`,
        );
      }

      // 3. Announcements
      const { publishScheduledAnnouncements } =
        await import("./controllers/announcementController.js");
      await publishScheduledAnnouncements();

      // ── V2: ANEM Offer Cooldown Processing ──
      try {
        const { processExpiredCooldowns } =
          await import("./controllers/anemOfferController.js");
        const publishedCount = await processExpiredCooldowns();
        if (publishedCount > 0) {
          console.log(
            `⏰ ANEM Cooldown: ${publishedCount} offre(s) publiée(s) automatiquement`,
          );
        }
      } catch (err) {
        console.error("⏰ ANEM cooldown processing error:", err.message);
      }

      // ── V2: ANEM Offer Auto-Cleanup ──
      try {
        const { processAutoCleanup } =
          await import("./controllers/anemOfferController.js");
        const cleanedCount = await processAutoCleanup();
        if (cleanedCount > 0) {
          console.log(
            `⏰ ANEM Cleanup: ${cleanedCount} offre(s) en échec supprimée(s)`,
          );
        }
      } catch (err) {
        console.error("⏰ ANEM auto-cleanup error:", err.message);
      }
    } catch (err) {
      console.error("⏰ Scheduled task error:", err.message);
    }
  };

  const INTERVAL_MS = 5 * 60 * 1000;
  setInterval(runScheduledTasks, INTERVAL_MS);
  setTimeout(runScheduledTasks, 10000);

  console.log("⏰ Scheduled tasks registered (runs every 5 minutes)");
}

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});

export default app;
