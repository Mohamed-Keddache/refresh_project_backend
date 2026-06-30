import nodemailer from "nodemailer";
import SystemSettings from "../models/SystemSettings.js";

const createTransporter = () => {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.error("❌ SMTP Configuration missing:", {
      host: !!host,
      port,
      user: !!user,
      pass: !!pass,
    });
    throw new Error(
      "SMTP configuration incomplete. Check environment variables.",
    );
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });
};

const templates = {
  verificationCode: (code, userName) => ({
    subject: "Confirmez votre adresse email",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px}.header{background:#4F46E5;color:white;padding:20px;text-align:center;border-radius:8px 8px 0 0}.content{background:#f9fafb;padding:30px;border-radius:0 0 8px 8px}.code{font-size:32px;font-weight:bold;color:#4F46E5;text-align:center;letter-spacing:8px;padding:20px;background:white;border-radius:8px;margin:20px 0}.footer{text-align:center;margin-top:20px;color:#666;font-size:12px}.warning{color:#dc2626;font-size:14px;margin-top:15px}</style></head><body><div class="container"><div class="header"><h1>Vérification de votre email</h1></div><div class="content"><p>Bonjour${userName ? ` ${userName}` : ""},</p><p>Merci de vous être inscrit ! Voici votre code de vérification :</p><div class="code">${code}</div><p>Ce code expire dans <strong>15 minutes</strong>.</p><p class="warning">Si vous n'avez pas demandé ce code, ignorez cet email.</p></div><div class="footer"><p>© ${new Date().getFullYear()} Plateforme de Recrutement</p></div></div></body></html>`,
    text: `Bonjour${userName ? ` ${userName}` : ""},\n\nVotre code de vérification est : ${code}\n\nCe code expire dans 15 minutes.`,
  }),

  welcomeEmail: (userName) => ({
    subject: "Bienvenue sur notre plateforme !",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div style="max-width:600px;margin:0 auto;padding:20px;font-family:Arial,sans-serif"><div style="background:#10b981;color:white;padding:20px;text-align:center;border-radius:8px 8px 0 0"><h1>🎉 Email vérifié avec succès !</h1></div><div style="background:#f9fafb;padding:30px;border-radius:0 0 8px 8px"><p>Bonjour ${userName || ""},</p><p>Votre adresse email a été vérifiée avec succès.</p></div></div></body></html>`,
    text: `Bonjour ${userName || ""}, votre email a été vérifié avec succès.`,
  }),

  passwordReset: (code, userName) => ({
    subject: "Réinitialisation de votre mot de passe",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px}.header{background:#dc2626;color:white;padding:20px;text-align:center;border-radius:8px 8px 0 0}.content{background:#f9fafb;padding:30px;border-radius:0 0 8px 8px}.code{font-size:32px;font-weight:bold;color:#dc2626;text-align:center;letter-spacing:8px;padding:20px;background:white;border-radius:8px;margin:20px 0;border:2px dashed #dc2626}.warning{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:15px;border-radius:8px;margin-top:20px}</style></head><body><div class="container"><div class="header"><h1>🔐 Réinitialisation</h1></div><div class="content"><p>Bonjour${userName ? ` ${userName}` : ""},</p><p>Voici votre code :</p><div class="code">${code}</div><p>Expire dans 20 minutes.</p><div class="warning">Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</div></div></div></body></html>`,
    text: `Code de réinitialisation : ${code}. Expire dans 20 minutes.`,
  }),

  passwordResetSuccess: (userName) => ({
    subject: "Votre mot de passe a été modifié",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div style="max-width:600px;margin:0 auto;padding:20px;font-family:Arial,sans-serif"><div style="background:#10b981;color:white;padding:20px;text-align:center;border-radius:8px 8px 0 0"><h1>✅ Mot de passe modifié</h1></div><div style="background:#f9fafb;padding:30px;border-radius:0 0 8px 8px"><p>Bonjour${userName ? ` ${userName}` : ""},</p><p>Votre mot de passe a été réinitialisé avec succès.</p></div></div></body></html>`,
    text: `Bonjour${userName ? ` ${userName}` : ""}, votre mot de passe a été réinitialisé.`,
  }),

  // ─── NEW: notification de modification/définition de mot de passe ───
  passwordChangedNotification: (
    userName,
    action,
    ipAddress,
    userAgent,
    logoutAll,
  ) => {
    const isSet = action === "set";
    const subject = isSet
      ? "🔒 Un mot de passe a été défini sur votre compte"
      : "🔒 Votre mot de passe a été modifié";

    const actionText = isSet
      ? "Un mot de passe a été défini sur votre compte. Vous pouvez désormais vous connecter avec votre adresse email et ce mot de passe, en plus de vos méthodes d'authentification existantes."
      : "Votre mot de passe a été modifié avec succès.";

    const dateStr = new Date().toLocaleString("fr-FR", {
      dateStyle: "long",
      timeStyle: "short",
    });

    return {
      subject,
      html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body{font-family:Arial,sans-serif;line-height:1.6;color:#333}
    .container{max-width:600px;margin:0 auto;padding:20px}
    .header{background:#10b981;color:white;padding:20px;text-align:center;border-radius:8px 8px 0 0}
    .content{background:#f9fafb;padding:30px;border-radius:0 0 8px 8px}
    .info-box{background:white;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:20px 0}
    .info-row{padding:8px 0;border-bottom:1px solid #f3f4f6}
    .info-row:last-child{border-bottom:none}
    .info-label{font-weight:bold;color:#6b7280;font-size:13px}
    .info-value{color:#111827;font-size:14px;margin-top:2px}
    .warning{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:15px;border-radius:8px;margin-top:20px}
    .success-badge{display:inline-block;background:#d1fae5;color:#065f46;padding:4px 12px;border-radius:9999px;font-size:12px;font-weight:bold;margin-top:8px}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔒 ${isSet ? "Mot de passe défini" : "Mot de passe modifié"}</h1>
    </div>
    <div class="content">
      <p>Bonjour${userName ? ` ${userName}` : ""},</p>
      <p>${actionText}</p>

      <div class="info-box">
        <div class="info-row">
          <div class="info-label">📅 Date</div>
          <div class="info-value">${dateStr}</div>
        </div>
        ${ipAddress ? `<div class="info-row"><div class="info-label">🌐 Adresse IP</div><div class="info-value">${ipAddress}</div></div>` : ""}
        ${userAgent ? `<div class="info-row"><div class="info-label">💻 Appareil</div><div class="info-value">${userAgent}</div></div>` : ""}
        ${logoutAll ? `<div class="info-row"><div class="info-value"><span class="success-badge">✓ Toutes les autres sessions ont été déconnectées</span></div></div>` : ""}
      </div>

      <div class="warning">
        <strong>⚠️ Vous n'êtes pas à l'origine de cette action ?</strong><br>
        Sécurisez immédiatement votre compte :
        <ul style="margin:8px 0 0 0;padding-left:20px">
          <li>Réinitialisez votre mot de passe via la page de connexion</li>
          <li>Vérifiez la sécurité de votre adresse email</li>
          <li>Contactez notre support sans délai</li>
        </ul>
      </div>
    </div>
  </div>
</body>
</html>`,
      text: `Bonjour${userName ? ` ${userName}` : ""},\n\n${actionText}\n\nDate : ${dateStr}\n${ipAddress ? `IP : ${ipAddress}\n` : ""}${logoutAll ? "Toutes les autres sessions ont été déconnectées.\n" : ""}\nSi vous n'êtes pas à l'origine de cette action, contactez immédiatement notre support.`,
    };
  },
};

export const sendEmail = async (to, templateName, templateData = {}) => {
  try {
    const mode = await SystemSettings.getSetting(
      "email_verification_mode",
      "development",
    );

    if (mode === "development") {
      console.log(`\n📧 [DEV MODE] Email à ${to}: ${templateName}`);
      if (templateData.code) console.log(`   Code: ${templateData.code}`);
      return { success: true, mode: "development" };
    }

    const transporter = createTransporter();
    await transporter.verify();

    let template;
    if (templateName === "passwordChangedNotification") {
      template = templates.passwordChangedNotification(
        templateData.userName,
        templateData.action,
        templateData.ipAddress,
        templateData.userAgent,
        templateData.logoutAll,
      );
    } else {
      template = templates[templateName]?.(
        templateData.code,
        templateData.userName,
      );
    }

    if (!template) throw new Error(`Template "${templateName}" not found`);

    const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
    const result = await transporter.sendMail({
      from: `"Plateforme Recrutement" <${fromEmail}>`,
      to,
      subject: template.subject,
      html: template.html,
      text: template.text,
    });

    console.log(`✅ Email envoyé à ${to}: ${result.messageId}`);
    return { success: true, messageId: result.messageId, mode: "smtp" };
  } catch (error) {
    console.error(`❌ Erreur envoi email à ${to}:`, error.message);
    throw error;
  }
};

export const sendPasswordResetEmail = async (email, code, userName = null) =>
  sendEmail(email, "passwordReset", { code, userName });

export const sendPasswordResetSuccessEmail = async (email, userName = null) =>
  sendEmail(email, "passwordResetSuccess", { userName });

export const sendVerificationEmail = async (email, code, userName = null) =>
  sendEmail(email, "verificationCode", { code, userName });

export const sendWelcomeEmail = async (email, userName = null) =>
  sendEmail(email, "welcomeEmail", { userName });

// ─── NEW ───
export const sendPasswordChangedNotification = async (
  email,
  { userName, action = "change", ipAddress, userAgent, logoutAll = false },
) =>
  sendEmail(email, "passwordChangedNotification", {
    userName,
    action,
    ipAddress,
    userAgent,
    logoutAll,
  });

export const verifySmtpConnection = async () => {
  try {
    if (
      !process.env.SMTP_HOST ||
      !process.env.SMTP_USER ||
      !process.env.SMTP_PASS
    ) {
      console.error("❌ SMTP environment variables not set");
      return false;
    }
    const transporter = createTransporter();
    await transporter.verify();
    console.log("✅ SMTP connection verified");
    return true;
  } catch (error) {
    console.error("❌ SMTP connection failed:", error.message);
    return false;
  }
};

export default {
  sendEmail,
  sendVerificationEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendPasswordResetSuccessEmail,
  sendPasswordChangedNotification,
  verifySmtpConnection,
};
