import nodemailer from "nodemailer";
import SystemSettings from "../models/SystemSettings.js";

// Create transporter with validation
const createTransporter = () => {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  // Validate config
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

  console.log("📧 Creating SMTP transporter with config:", {
    host,
    port,
    user,
    secure: port === 465,
  });

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465, false for other ports
    auth: {
      user,
      pass,
    },
    // Add timeout and connection settings
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });
};

// Email templates
const templates = {
  verificationCode: (code, userName) => ({
    subject: "Confirmez votre adresse email",
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
          .code { font-size: 32px; font-weight: bold; color: #4F46E5; text-align: center; letter-spacing: 8px; padding: 20px; background: white; border-radius: 8px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
          .warning { color: #dc2626; font-size: 14px; margin-top: 15px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Vérification de votre email</h1>
          </div>
          <div class="content">
            <p>Bonjour${userName ? ` ${userName}` : ""},</p>
            <p>Merci de vous être inscrit ! Voici votre code de vérification :</p>
            <div class="code">${code}</div>
            <p>Ce code expire dans <strong>15 minutes</strong>.</p>
            <p class="warning">Si vous n'avez pas demandé ce code, ignorez cet email.</p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Plateforme de Recrutement</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `Bonjour${userName ? ` ${userName}` : ""},\n\nVotre code de vérification est : ${code}\n\nCe code expire dans 15 minutes.\n\nSi vous n'avez pas demandé ce code, ignorez cet email.`,
  }),

  welcomeEmail: (userName) => ({
    subject: "Bienvenue sur notre plateforme !",
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #10b981; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
          .button { display: inline-block; background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 15px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 Email vérifié avec succès !</h1>
          </div>
          <div class="content">
            <p>Bonjour ${userName || ""},</p>
            <p>Votre adresse email a été vérifiée avec succès. Votre compte est maintenant pleinement actif !</p>
            <p>Vous pouvez maintenant :</p>
            <ul>
              <li>Compléter votre profil</li>
              <li>Télécharger votre CV</li>
              <li>Postuler aux offres d'emploi</li>
            </ul>
            <p>Bonne recherche d'emploi !</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `Bonjour ${userName || ""},\n\nVotre adresse email a été vérifiée avec succès. Votre compte est maintenant pleinement actif !\n\nBonne recherche d'emploi !`,
  }),
  passwordReset: (code, userName) => ({
    subject: "Réinitialisation de votre mot de passe",
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #dc2626; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
          .code { font-size: 32px; font-weight: bold; color: #dc2626; text-align: center; letter-spacing: 8px; padding: 20px; background: white; border-radius: 8px; margin: 20px 0; border: 2px dashed #dc2626; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
          .warning { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; padding: 15px; border-radius: 8px; margin-top: 20px; }
          .info { background: #eff6ff; border: 1px solid #bfdbfe; color: #1e40af; padding: 12px; border-radius: 6px; margin-top: 15px; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔐 Réinitialisation du mot de passe</h1>
          </div>
          <div class="content">
            <p>Bonjour${userName ? ` ${userName}` : ""},</p>
            <p>Vous avez demandé la réinitialisation de votre mot de passe. Voici votre code de vérification :</p>
            <div class="code">${code}</div>
            <div class="info">
              <strong>⏱️ Ce code expire dans 20 minutes.</strong><br>
              Vous avez droit à 3 tentatives pour entrer le code correct.
            </div>
            <div class="warning">
              <strong>⚠️ Attention :</strong><br>
              Si vous n'avez pas demandé cette réinitialisation, ignorez cet email et votre mot de passe restera inchangé.<br><br>
              Si vous pensez que quelqu'un essaie d'accéder à votre compte, nous vous recommandons de sécuriser votre email.
            </div>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Plateforme de Recrutement</p>
            <p>Cet email a été envoyé suite à une demande de réinitialisation de mot de passe.</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `Bonjour${userName ? ` ${userName}` : ""},\n\nVous avez demandé la réinitialisation de votre mot de passe.\n\nVotre code de vérification est : ${code}\n\nCe code expire dans 20 minutes.\nVous avez droit à 3 tentatives pour entrer le code correct.\n\nSi vous n'avez pas demandé cette réinitialisation, ignorez cet email.\n\nPlateforme de Recrutement`,
  }),

  passwordResetSuccess: (userName) => ({
    subject: "Votre mot de passe a été modifié",
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #10b981; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
          .warning { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; padding: 15px; border-radius: 8px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>✅ Mot de passe modifié</h1>
          </div>
          <div class="content">
            <p>Bonjour${userName ? ` ${userName}` : ""},</p>
            <p>Votre mot de passe a été modifié avec succès le <strong>${new Date().toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })}</strong>.</p>
            <p>Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.</p>
            <div class="warning">
              <strong>⚠️ Ce n'était pas vous ?</strong><br>
              Si vous n'avez pas effectué cette modification, contactez immédiatement notre support et sécurisez votre compte email.
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `Bonjour${userName ? ` ${userName}` : ""},\n\nVotre mot de passe a été modifié avec succès.\n\nSi vous n'avez pas effectué cette modification, contactez immédiatement notre support.`,
  }),
};

// Main send email function
export const sendEmail = async (to, templateName, templateData = {}) => {
  try {
    const mode = await SystemSettings.getSetting(
      "email_verification_mode",
      "development",
    );

    console.log(`📧 Email mode: ${mode}`);
    console.log(`📧 Sending to: ${to}`);
    console.log(`📧 Template: ${templateName}`);

    if (mode === "development") {
      const template = templates[templateName]?.(
        templateData.code,
        templateData.userName,
      );
      console.log(`\n📧 [DEV MODE] Email à ${to}:`);
      console.log(`   Sujet: ${template?.subject}`);
      if (templateData.code) {
        console.log(`   Code: ${templateData.code}`);
      }
      console.log("");
      return { success: true, mode: "development" };
    }

    // SMTP mode
    console.log(`📧 SMTP Config Check:`, {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      user: process.env.SMTP_USER,
      passExists: !!process.env.SMTP_PASS,
    });

    const transporter = createTransporter();

    // Verify connection first
    console.log("📧 Verifying SMTP connection...");
    await transporter.verify();
    console.log("📧 SMTP connection verified successfully");

    const template = templates[templateName]?.(
      templateData.code,
      templateData.userName,
    );

    if (!template) {
      throw new Error(`Template "${templateName}" not found`);
    }

    const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;

    const mailOptions = {
      from: `"Plateforme Recrutement" <${fromEmail}>`,
      to,
      subject: template.subject,
      html: template.html,
      text: template.text,
    };

    console.log("📧 Sending email with options:", {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject,
    });

    const result = await transporter.sendMail(mailOptions);

    console.log(`✅ Email envoyé à ${to}: ${result.messageId}`);
    return { success: true, messageId: result.messageId, mode: "smtp" };
  } catch (error) {
    console.error(`❌ Erreur envoi email à ${to}:`, error);
    console.error("Error details:", {
      message: error.message,
      code: error.code,
      command: error.command,
    });
    throw error;
  }
};
// Add these export functions
export const sendPasswordResetEmail = async (email, code, userName = null) => {
  return sendEmail(email, "passwordReset", { code, userName });
};

export const sendPasswordResetSuccessEmail = async (email, userName = null) => {
  return sendEmail(email, "passwordResetSuccess", { userName });
};

// Convenience functions
export const sendVerificationEmail = async (email, code, userName = null) => {
  return sendEmail(email, "verificationCode", { code, userName });
};

export const sendWelcomeEmail = async (email, userName = null) => {
  return sendEmail(email, "welcomeEmail", { userName });
};

// Verify SMTP connection
export const verifySmtpConnection = async () => {
  try {
    console.log("🔍 Checking SMTP environment variables...");
    console.log({
      SMTP_HOST: process.env.SMTP_HOST,
      SMTP_PORT: process.env.SMTP_PORT,
      SMTP_USER: process.env.SMTP_USER,
      SMTP_PASS: process.env.SMTP_PASS ? "****" : "NOT SET",
    });

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
  verifySmtpConnection,
};
