import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Candidate from "../models/Candidate.js";
import Company from "../models/Company.js";
import Recruiter from "../models/Recruiter.js";
import VerificationToken from "../models/VerificationToken.js";
import SystemSettings from "../models/SystemSettings.js";
import Application from "../models/Application.js";
import Interview from "../models/Interview.js";
import Offer from "../models/Offer.js";
import {
  sendVerificationEmail,
  sendWelcomeEmail,
} from "../services/emailService.js";

const generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
      emailVerified: user.emailVerified,
    },
    process.env.JWT_SECRET,
    { expiresIn: "1d" },
  );
};

function getRecruiterStatusMessage(status) {
  const messages = {
    incomplete: "Veuillez compléter votre profil recruteur pour continuer.",
    pending_validation:
      "Votre compte est en attente de validation par un administrateur.",
    pending_documents:
      "Des documents vous ont été demandés. Veuillez les fournir.",
    pending_info: "Des informations complémentaires vous ont été demandées.",
    pending_info_and_documents:
      "Des informations et des documents vous ont été demandés.",
    pending_revalidation: "Vos réponses sont en cours d'examen.",
  };
  return messages[status] || "Statut en attente.";
}

export const register = async (req, res) => {
  try {
    const { nom, email, motDePasse, role } = req.body;

    const exist = await User.findOne({ email: email.toLowerCase() });
    if (exist) {
      return res.status(400).json({ msg: "Email déjà utilisé" });
    }

    const hash = await bcrypt.hash(motDePasse, 12);

    const user = await User.create({
      nom,
      email: email.toLowerCase(),
      motDePasse: hash,
      role,
      emailVerified: false,
      accountStatus: "active",
    });

    try {
      if (role === "recruteur") {
        await Recruiter.create({
          userId: user._id,
          status: "incomplete",
        });
      } else if (role === "candidat") {
        await Candidate.create({
          userId: user._id,
        });
      }

      const verificationMode = await SystemSettings.getSetting(
        "email_verification_mode",
        "development",
      );

      console.log(
        `📧 Registration - Email verification mode: ${verificationMode}`,
      );

      if (verificationMode === "smtp") {
        try {
          const { code } = await VerificationToken.createVerificationToken(
            user._id,
            "email_verification",
            15,
          );

          console.log(`📧 Sending verification email to ${user.email}`);
          await sendVerificationEmail(user.email, code, user.nom);
          console.log(`✅ Verification email sent successfully`);
        } catch (emailError) {
          console.error("❌ Failed to send verification email:", emailError);
        }
      } else {
        console.log(
          `📨 [DEV MODE] User Registered: ${user.email}. Use code: 123456`,
        );
      }

      const token = generateToken(user);

      return res.status(201).json({
        msg: "Inscription réussie. Vérifiez votre email.",
        token,
        user: {
          id: user._id,
          email: user.email,
          role: user.role,
          emailVerified: false,
        },
        needsEmailVerification: true,
      });
    } catch (err) {
      await User.findByIdAndDelete(user._id);
      throw err;
    }
  } catch (err) {
    console.error("Registration error:", err);
    return res.status(500).json({ msg: err.message });
  }
};

export const login = async (req, res) => {
  try {
    const { email, motDePasse } = req.body;
    const GENERIC_ERROR = "Email ou mot de passe incorrect";

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      await bcrypt.hash("dummy_password_timing_protection", 12);
      return res
        .status(401)
        .json({ msg: GENERIC_ERROR, code: "INVALID_CREDENTIALS" });
    }

    const ok = await bcrypt.compare(motDePasse, user.motDePasse);
    if (!ok) {
      return res
        .status(401)
        .json({ msg: GENERIC_ERROR, code: "INVALID_CREDENTIALS" });
    }

    if (!user.canLogin()) {
      if (user.accountStatus === "banned") {
        return res.status(403).json({
          msg: "Votre compte a été banni. Veuillez contacter l'administrateur.",
          code: "ACCOUNT_BANNED",
        });
      }
      if (user.accountStatus === "suspended") {
        return res.status(403).json({
          msg: `Votre compte est suspendu${
            user.suspendedUntil
              ? ` jusqu'au ${user.suspendedUntil.toLocaleDateString("fr-FR")}`
              : ""
          }.`,
          code: "ACCOUNT_SUSPENDED",
          reason: user.suspensionReason,
        });
      }
    }

    if (user.role === "recruteur") {
      if (!user.emailVerified) {
        const token = generateToken(user);
        return res.status(403).json({
          msg: "Veuillez confirmer votre email avant de vous connecter.",
          code: "EMAIL_NOT_VERIFIED",
          needEmailVerification: true,
          token,
        });
      }

      const recruiter = await Recruiter.findOne({ userId: user._id });
      if (recruiter) {
        if (recruiter.status === "rejected") {
          return res.status(403).json({
            msg: "Votre compte recruteur a été refusé.",
            code: "RECRUITER_REJECTED",
            reason: recruiter.rejectionReason,
          });
        }

        if (recruiter.status !== "validated") {
          const token = generateToken(user);
          user.derniereConnexion = new Date();
          await user.save();

          return res.json({
            msg: "Connexion réussie (accès limité)",
            token,
            user: {
              id: user._id,
              nom: user.nom,
              email: user.email,
              role: user.role,
              emailVerified: user.emailVerified,
            },
            recruiterStatus: recruiter.status,
            limitedAccess: true,
            statusMessage: getRecruiterStatusMessage(recruiter.status),
          });
        }
      }
    }

    const token = generateToken(user);
    user.derniereConnexion = new Date();
    await user.save();

    res.json({
      msg: "Connexion réussie ✅",
      token,
      user: {
        id: user._id,
        nom: user.nom,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerified,
      },
      needsEmailVerification: !user.emailVerified,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const resendConfirmationCode = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ msg: "Utilisateur introuvable" });
    }

    if (user.emailVerified) {
      return res.status(400).json({ msg: "Email déjà vérifié" });
    }

    const verificationMode = await SystemSettings.getSetting(
      "email_verification_mode",
      "development",
    );

    if (verificationMode === "smtp") {
      try {
        const { code, expiresAt } =
          await VerificationToken.createVerificationToken(
            user._id,
            "email_verification",
            15,
          );

        await sendVerificationEmail(user.email, code, user.nom);

        res.json({
          msg: "Code de confirmation envoyé 📨",
          expiresAt,
        });
      } catch (emailError) {
        console.error("❌ Failed to send verification email:", emailError);
        res.status(500).json({
          msg: "Erreur lors de l'envoi de l'email. Veuillez réessayer.",
          error:
            process.env.NODE_ENV !== "production"
              ? emailError.message
              : undefined,
        });
      }
    } else {
      res.json({
        msg: "Code de confirmation envoyé (Mode développement: utilisez 123456) 📨",
      });
    }
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const verifyEmail = async (req, res) => {
  try {
    const { code } = req.body;
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ msg: "Utilisateur introuvable" });
    }

    if (user.emailVerified) {
      return res.status(400).json({ msg: "Email déjà vérifié" });
    }

    const verificationMode = await SystemSettings.getSetting(
      "email_verification_mode",
      "development",
    );

    let isValid = false;

    if (verificationMode === "development") {
      isValid = code === "123456";
      if (!isValid) {
        return res.status(400).json({
          msg: "Code incorrect. Utilisez 123456 en mode développement.",
        });
      }
    } else {
      const result = await VerificationToken.verifyCode(
        userId,
        code,
        "email_verification",
      );

      if (!result.valid) {
        return res.status(400).json({
          msg: result.error,
          attemptsRemaining: result.attemptsRemaining,
        });
      }
      isValid = true;
    }

    if (isValid) {
      user.emailVerified = true;
      await user.save();

      try {
        await sendWelcomeEmail(user.email, user.nom);
      } catch (emailErr) {
        console.error("Failed to send welcome email:", emailErr);
      }

      const newToken = generateToken(user);

      return res.json({
        msg: "E-mail confirmé avec succès ! 🎉",
        token: newToken,
        user: {
          id: user._id,
          nom: user.nom,
          email: user.email,
          role: user.role,
          emailVerified: true,
        },
      });
    }
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const changeEmail = async (req, res) => {
  try {
    const { newEmail } = req.body;
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ msg: "Utilisateur introuvable" });
    }

    if (user.emailVerified) {
      return res.status(400).json({
        msg: "Impossible de changer l'email car il est déjà vérifié.",
      });
    }

    const normalizedEmail = newEmail.toLowerCase();
    const exist = await User.findOne({
      email: normalizedEmail,
      _id: { $ne: userId },
    });
    if (exist) {
      return res.status(400).json({ msg: "Cet email est déjà utilisé." });
    }

    user.email = normalizedEmail;
    await user.save();

    await VerificationToken.deleteMany({ userId, type: "email_verification" });

    res.json({
      msg: `Email mis à jour vers ${normalizedEmail}. Veuillez confirmer ce nouvel email.`,
      email: normalizedEmail,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const changePassword = async (req, res) => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword, confirmNewPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        msg: "Le mot de passe actuel et le nouveau mot de passe sont requis.",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        msg: "Le nouveau mot de passe doit contenir au moins 8 caractères.",
      });
    }

    if (
      !/[a-z]/.test(newPassword) ||
      !/[A-Z]/.test(newPassword) ||
      !/\d/.test(newPassword)
    ) {
      return res.status(400).json({
        msg: "Le mot de passe doit contenir une minuscule, une majuscule et un chiffre.",
      });
    }

    if (confirmNewPassword && newPassword !== confirmNewPassword) {
      return res
        .status(400)
        .json({ msg: "Les mots de passe ne correspondent pas." });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ msg: "Utilisateur introuvable." });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.motDePasse);
    if (!isMatch) {
      return res.status(401).json({ msg: "Mot de passe actuel incorrect." });
    }

    const isSame = await bcrypt.compare(newPassword, user.motDePasse);
    if (isSame) {
      return res.status(400).json({
        msg: "Le nouveau mot de passe doit être différent de l'ancien.",
      });
    }

    const hash = await bcrypt.hash(newPassword, 12);
    user.motDePasse = hash;
    await user.save();

    const token = generateToken(user);

    res.json({
      msg: "Mot de passe modifié avec succès ✅",
      token,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// ══════════════════════════════════════════════════════════════
// BUG 4 FIX: Nettoyage des conversations et tickets de support
// lors de la suppression du compte.
// ══════════════════════════════════════════════════════════════
export const deleteMyAccount = async (req, res) => {
  try {
    const userId = req.user.id;
    const { password, confirmation } = req.body;

    if (confirmation !== "SUPPRIMER MON COMPTE") {
      return res.status(400).json({
        msg: "Veuillez confirmer en écrivant 'SUPPRIMER MON COMPTE'.",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ msg: "Utilisateur introuvable." });
    }

    const hasOAuthOnly = user.oauthProviders && user.oauthProviders.length > 0;

    if (!hasOAuthOnly) {
      if (!password) {
        return res
          .status(400)
          .json({ msg: "Mot de passe requis pour confirmer." });
      }
      const isMatch = await bcrypt.compare(password, user.motDePasse);
      if (!isMatch) {
        return res.status(401).json({ msg: "Mot de passe incorrect." });
      }
    }

    if (user.role === "admin") {
      return res.status(403).json({
        msg: "Un administrateur ne peut pas supprimer son propre compte via cette route.",
      });
    }

    const mongoose = (await import("mongoose")).default;
    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        if (user.role === "candidat") {
          const candidate = await Candidate.findOne({ userId }).session(
            session,
          );
          if (candidate) {
            const activeApps = await Application.find({
              candidateId: candidate._id,
              candidateStatus: {
                $in: ["envoyee", "en_cours", "entretien", "retenue"],
              },
            }).session(session);

            for (const app of activeApps) {
              app.candidateStatus = "retiree";
              app.recruiterStatus = "retiree_par_candidat";
              app.withdrawnAt = new Date();
              app.withdrawReason = "Compte supprimé par l'utilisateur";
              await app.save({ session });

              await Offer.findByIdAndUpdate(
                app.offerId,
                { $inc: { nombreCandidatures: -1 } },
                { session },
              );
            }

            await Interview.updateMany(
              {
                candidateId: candidate._id,
                status: {
                  $in: [
                    "proposed",
                    "confirmed",
                    "rescheduled_by_candidate",
                    "rescheduled_by_recruiter",
                  ],
                },
              },
              {
                status: "cancelled_by_candidate",
                cancellationReason: "Compte supprimé",
                cancelledAt: new Date(),
              },
              { session },
            );

            // ── BUG 4 FIX: Fermer proprement les conversations ──
            const Conversation = (await import("../models/Conversation.js"))
              .default;
            await Conversation.updateMany(
              { candidateId: candidate._id, isClosed: { $ne: true } },
              {
                $set: {
                  isClosed: true,
                  closedReason: "application_closed",
                },
                $push: {
                  messages: {
                    senderId: userId,
                    senderType: "system",
                    content: "Le candidat a supprimé son compte.",
                    messageType: "system",
                    createdAt: new Date(),
                  },
                },
                $inc: { unreadByRecruiter: 1 },
              },
              { session },
            );

            // ── BUG 4 FIX: Fermer les tickets de support ouverts ──
            const SupportTicket = (await import("../models/SupportTicket.js"))
              .default;
            await SupportTicket.updateMany(
              { userId, status: { $nin: ["closed", "resolved"] } },
              {
                $set: {
                  status: "closed",
                  closedAt: new Date(),
                },
              },
              { session },
            );

            try {
              const {
                deleteMultipleFromCloudinary,
                deleteFromCloudinary,
                getPublicIdFromUrl,
              } = await import("../config/cloudinary.js");

              const cvUrls = candidate.cvs.map((cv) => cv.url).filter(Boolean);
              if (cvUrls.length > 0) {
                await deleteMultipleFromCloudinary(cvUrls);
              }
              if (candidate.profilePicture) {
                const pubId = getPublicIdFromUrl(candidate.profilePicture);
                if (pubId) await deleteFromCloudinary(pubId, "image");
              }
            } catch (cloudErr) {
              console.error(
                "Cloudinary cleanup error (non-blocking):",
                cloudErr,
              );
            }

            await Candidate.deleteOne({ _id: candidate._id }).session(session);
          }

          const CandidateAnemRegistration = (
            await import("../models/CandidateAnemRegistration.js")
          ).default;
          await CandidateAnemRegistration.deleteMany({ userId }).session(
            session,
          );
        } else if (user.role === "recruteur") {
          const recruiter = await Recruiter.findOne({ userId }).session(
            session,
          );
          if (recruiter) {
            const myOfferIds = await Offer.find({
              recruteurId: recruiter._id,
            }).distinct("_id");
            const activeOfferApps = await Application.countDocuments({
              offerId: { $in: myOfferIds },
              recruiterStatus: {
                $nin: [
                  "refusee",
                  "retiree_par_candidat",
                  "annulee_par_candidat",
                  "embauche",
                  "offer_declined",
                ],
              },
            });

            if (activeOfferApps > 0) {
              throw new Error(
                "Vous avez des candidatures actives en cours. Veuillez d'abord les traiter.",
              );
            }

            await Recruiter.deleteOne({ _id: recruiter._id }).session(session);
          }

          const AnemRegistration = (
            await import("../models/AnemRegistration.js")
          ).default;
          await AnemRegistration.deleteMany({ userId }).session(session);
        }

        const Notification = (await import("../models/Notification.js"))
          .default;
        await Notification.deleteMany({ userId }).session(session);

        await VerificationToken.deleteMany({ userId }).session(session);

        await User.deleteOne({ _id: userId }).session(session);
      });

      res.json({ msg: "Votre compte a été supprimé avec succès. Au revoir." });
    } finally {
      await session.endSession();
    }
  } catch (err) {
    if (err.message.includes("candidatures actives")) {
      return res.status(400).json({ msg: err.message });
    }
    res.status(500).json({ msg: err.message });
  }
};

export const getCompanies = async (req, res) => {
  try {
    const companies = await Company.find({ status: "active" })
      .select("_id name")
      .sort({ name: 1 })
      .lean();

    res.json(companies);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};
