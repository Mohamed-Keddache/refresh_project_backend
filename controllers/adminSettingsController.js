import SystemSettings from "../models/SystemSettings.js";
import { verifySmtpConnection } from "../services/emailService.js";

/**
 * Toggle email verification mode between SMTP and development
 * POST /api/admin/settings/email-verification-mode
 */
export const toggleEmailVerificationMode = async (req, res) => {
  try {
    const { mode } = req.body;

    if (!["smtp", "development"].includes(mode)) {
      return res.status(400).json({
        msg: "Mode invalide. Utilisez 'smtp' ou 'development'.",
      });
    }

    // If switching to SMTP, verify connection first
    if (mode === "smtp") {
      const isConnected = await verifySmtpConnection();
      if (!isConnected) {
        return res.status(400).json({
          msg: "Impossible d'activer le mode SMTP : connexion SMTP échouée. Vérifiez les variables d'environnement SMTP.",
        });
      }
    }

    await SystemSettings.setSetting(
      "email_verification_mode",
      mode,
      "Mode de vérification email",
      req.user.id,
    );

    res.json({
      msg: `Mode de vérification email changé en : ${mode}`,
      mode,
      description:
        mode === "smtp"
          ? "Les emails de vérification seront envoyés via SMTP"
          : "Mode développement actif : le code 123456 sera accepté pour tous les utilisateurs",
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Get current email verification mode
 * GET /api/admin/settings/email-verification-mode
 */
export const getEmailVerificationMode = async (req, res) => {
  try {
    const mode = await SystemSettings.getSetting(
      "email_verification_mode",
      "development",
    );

    res.json({
      mode,
      description:
        mode === "smtp"
          ? "Les emails de vérification sont envoyés via SMTP"
          : "Mode développement : le code 123456 est accepté",
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Toggle skill proposal feature
 * POST /api/admin/settings/skill-proposal
 */
export const toggleSkillProposal = async (req, res) => {
  try {
    const { enabled } = req.body;

    if (typeof enabled !== "boolean") {
      return res
        .status(400)
        .json({ msg: "Valeur 'enabled' requise (boolean)" });
    }

    await SystemSettings.setSetting(
      "skill_proposal_enabled",
      enabled,
      "Permet aux candidats de proposer de nouvelles compétences",
      req.user.id,
    );

    res.json({
      msg: enabled
        ? "Proposition de compétences activée"
        : "Proposition de compétences désactivée",
      enabled,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Get all system settings (for admin dashboard)
 * GET /api/admin/settings
 */
export const getAllSettings = async (req, res) => {
  try {
    const settings = await SystemSettings.find({})
      .select("-__v")
      .populate("updatedBy", "nom email");

    res.json(settings);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};
