import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import morgan from "morgan";
import connectDB from "./config/db.js";
import setupFolders from "./startup/setupFolders.js";
import { seedAdmin } from "./startup/seedAdmin.js";
import { setupSecurity } from "./middleware/security.js";
import SystemSettings from "./models/SystemSettings.js";
import { verifySmtpConnection } from "./services/emailService.js";

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

const app = express();

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

if (process.env.NODE_ENV !== "test") {
  app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
}

app.use("/uploads", express.static("uploads"));

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ msg: "JSON invalide" });
  }
  next(err);
});

async function startServer() {
  try {
    // Log environment variables at startup (without sensitive data)
    console.log("🔧 Environment check:");
    console.log("   NODE_ENV:", process.env.NODE_ENV || "development");
    console.log("   SMTP_HOST:", process.env.SMTP_HOST || "NOT SET");
    console.log("   SMTP_PORT:", process.env.SMTP_PORT || "NOT SET");
    console.log("   SMTP_USER:", process.env.SMTP_USER || "NOT SET");
    console.log("   SMTP_PASS:", process.env.SMTP_PASS ? "SET" : "NOT SET");

    await connectDB();
    setupFolders();

    await seedAdmin();

    await SystemSettings.initializeDefaults();
    console.log("⚙️ Paramètres système initialisés");

    // Check SMTP connection if mode is smtp
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
        // Optionally auto-switch to development mode
        // await SystemSettings.setSetting("email_verification_mode", "development");
      }
    } else {
      console.log("📧 Development mode: Use code 123456 for verification");
    }

    // Routes
    app.use("/api/auth", authRoutes);
    app.use("/api/skills", skillRoutes);
    app.use("/api/offers", offerRoutes);
    app.use("/api/candidates", candidateRoutes);
    app.use("/api/notifications", notificationRoutes);
    app.use("/api/support", supportRoutes);
    app.use("/api/announcements", announcementRoutes);

    app.use("/api/recruiters", recruiterRoutes);
    app.use("/api/admin", adminRoutes);
    app.use("/api/anem", anemRoutes);

    // Health endpoints
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
      }),
    );

    // Debug endpoint for email testing (remove in production)
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
    }

    // 404 handler
    app.use((req, res) => {
      res.status(404).json({ msg: "Route non trouvée" });
    });

    // Error handler
    app.use((err, req, res, next) => {
      console.error("❌ Erreur serveur:", err);

      const message =
        process.env.NODE_ENV === "production"
          ? "Erreur interne du serveur"
          : err.message;

      res.status(err.status || 500).json({
        msg: message,
        ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
      });
    });

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`🚀 Serveur lancé sur le port ${PORT}`);
      console.log(`📊 Environnement: ${process.env.NODE_ENV || "development"}`);
    });
  } catch (error) {
    console.error("❌ Erreur lors du démarrage du serveur :", error);
    process.exit(1);
  }
}

startServer();

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});

export default app;
