// controllers/oauthController.js
import { OAuth2Client } from "google-auth-library";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import Candidate from "../models/Candidate.js";
import Recruiter from "../models/Recruiter.js";
import { generateToken } from "../utils/generateToken.js"; // 🆕 helper centralisé

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ─── Build user response (shared helper) ──────────────────────────────
const buildUserResponse = async (user, isNew = false) => {
  const token = generateToken(user); // 🆕 inclut tokenVersion
  const response = {
    token,
    user: {
      id: user._id,
      nom: user.nom,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerified,
      hasPassword: !!user.hasPassword, // 🆕 utile pour le frontend
    },
    isNewUser: isNew,
  };

  if (user.role === "recruteur") {
    const recruiter = await Recruiter.findOne({ userId: user._id });
    if (recruiter) {
      response.recruiterStatus = recruiter.status;
      response.limitedAccess = recruiter.status !== "validated";
      response.needsOnboarding = recruiter.status === "incomplete";
    }
  }

  return response;
};

// ═══════════════════════════════════════════════════════════════════════
// METHOD 1: Google One-Tap / ID Token verification (recommended for SPA)
// ═══════════════════════════════════════════════════════════════════════
export const googleTokenLogin = async (req, res) => {
  try {
    const { credential, role } = req.body;
    if (!credential) {
      return res.status(400).json({ msg: "Token Google manquant." });
    }

    let ticket;
    try {
      ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
    } catch (verifyError) {
      return res.status(401).json({ msg: "Token Google invalide ou expiré." });
    }

    const payload = ticket.getPayload();
    const email = payload.email.toLowerCase();
    const nom =
      payload.name ||
      `${payload.given_name || ""} ${payload.family_name || ""}`.trim();
    const profilePicture = payload.picture || null;

    let user = await User.findOne({ email });

    // ── Utilisateur existant → connexion ─────────────────────────────
    if (user) {
      if (!user.canLogin()) {
        return res.status(403).json({
          msg: "Votre compte est suspendu ou banni.",
          code: "ACCOUNT_SUSPENDED",
        });
      }

      const hasGoogle = user.oauthProviders?.some(
        (p) => p.provider === "google",
      );
      if (!hasGoogle) {
        user.oauthProviders = user.oauthProviders || [];
        user.oauthProviders.push({
          provider: "google",
          providerId: payload.sub,
          linkedAt: new Date(),
        });
      }

      user.emailVerified = true;
      user.derniereConnexion = new Date();
      await user.save();

      const response = await buildUserResponse(user, false);
      response.msg = "Connexion réussie via Google ✅";
      return res.json(response);
    }

    // ── Nouvel utilisateur sans rôle → demander le rôle au frontend ──
    if (!role) {
      return res.status(200).json({
        isNewUser: true,
        needsRoleSelection: true,
        email,
        nom,
        profilePicture,
      });
    }

    // ── Création du nouvel utilisateur ───────────────────────────────
    const randomPassword = crypto.randomBytes(32).toString("hex");
    const hashedPassword = await bcrypt.hash(randomPassword, 12);

    user = await User.create({
      nom,
      email,
      motDePasse: hashedPassword,
      hasPassword: false, // 🆕 mot de passe aléatoire → l'utilisateur n'en a pas vraiment défini
      role,
      emailVerified: true,
      accountStatus: "active",
      oauthProviders: [
        { provider: "google", providerId: payload.sub, linkedAt: new Date() },
      ],
      derniereConnexion: new Date(),
    });

    if (role === "candidat") {
      await Candidate.create({ userId: user._id, profilePicture });
    } else if (role === "recruteur") {
      await Recruiter.create({ userId: user._id, status: "incomplete" });
    }

    const response = await buildUserResponse(user, true);
    response.msg = "Compte créé avec succès via Google ! 🎉";
    if (role === "recruteur") {
      response.needsOnboarding = true;
    }
    res.json(response);
  } catch (err) {
    console.error("googleTokenLogin error:", err);
    res.status(500).json({ msg: "Erreur lors de la connexion avec Google." });
  }
};

// ═══════════════════════════════════════════════════════════════════════
// METHOD 2: Passport OAuth callback handler (redirect-based flow)
// ═══════════════════════════════════════════════════════════════════════
export const oauthCallbackHandler = (provider) => {
  return async (req, res) => {
    try {
      const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

      if (!req.user) {
        return res.redirect(
          `${FRONTEND_URL}/auth/oauth-error?error=authentication_failed`,
        );
      }

      const { user, isNew } = req.user;

      if (!user.canLogin()) {
        return res.redirect(
          `${FRONTEND_URL}/auth/oauth-error?error=account_restricted&status=${user.accountStatus}`,
        );
      }

      const token = generateToken(user); // 🆕

      const params = new URLSearchParams({
        token,
        isNew: isNew ? "true" : "false",
        provider,
      });

      if (isNew && user.role === "recruteur") {
        params.set("needsCompany", "true");
      }

      res.redirect(`${FRONTEND_URL}/auth/oauth-callback?${params.toString()}`);
    } catch (err) {
      console.error(`${provider} OAuth callback error:`, err);
      const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
      if (err.message === "ACCOUNT_RESTRICTED") {
        return res.redirect(
          `${FRONTEND_URL}/auth/oauth-error?error=account_restricted&status=${err.accountStatus}`,
        );
      }
      res.redirect(`${FRONTEND_URL}/auth/oauth-error?error=server_error`);
    }
  };
};

// ═══════════════════════════════════════════════════════════════════════
// Facebook Token Login
// ═══════════════════════════════════════════════════════════════════════
export const facebookTokenLogin = async (req, res) => {
  try {
    const { accessToken, role } = req.body;
    if (!accessToken) {
      return res.status(400).json({ msg: "Token Facebook manquant." });
    }

    let fbResponse;
    try {
      const fbUrl = `https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=${accessToken}`;
      const response = await fetch(fbUrl);
      fbResponse = await response.json();
      if (fbResponse.error) {
        console.error("Facebook token error:", fbResponse.error);
        return res.status(401).json({ msg: "Token Facebook invalide." });
      }
    } catch (fbError) {
      console.error("Facebook API error:", fbError);
      return res.status(401).json({ msg: "Erreur de vérification Facebook." });
    }

    if (!fbResponse.email) {
      return res.status(400).json({
        msg: "Aucun email trouvé. Veuillez autoriser l'accès à votre email Facebook.",
      });
    }

    const email = fbResponse.email.toLowerCase();
    const nom = fbResponse.name || email.split("@")[0];
    const profilePicture = fbResponse.picture?.data?.url || null;

    let user = await User.findOne({ email });
    let isNew = false;

    if (user) {
      if (!user.canLogin()) {
        if (user.accountStatus === "banned") {
          return res.status(403).json({
            msg: "Votre compte a été banni.",
            code: "ACCOUNT_BANNED",
          });
        }
        if (user.accountStatus === "suspended") {
          return res.status(403).json({
            msg: "Votre compte est suspendu.",
            code: "ACCOUNT_SUSPENDED",
          });
        }
      }

      if (!user.oauthProviders) user.oauthProviders = [];

      const hasFacebook = user.oauthProviders.some(
        (p) => p.provider === "facebook",
      );
      if (!hasFacebook) {
        user.oauthProviders.push({
          provider: "facebook",
          providerId: fbResponse.id,
          linkedAt: new Date(),
        });
      }

      if (!user.emailVerified) user.emailVerified = true;
      user.derniereConnexion = new Date();
      await user.save();
    } else {
      isNew = true;
      const selectedRole = role === "recruteur" ? "recruteur" : "candidat";
      const randomPassword = crypto.randomBytes(32).toString("hex");
      const hashedPassword = await bcrypt.hash(randomPassword, 12);

      user = await User.create({
        nom,
        email,
        motDePasse: hashedPassword,
        hasPassword: false, // 🆕
        role: selectedRole,
        emailVerified: true,
        accountStatus: "active",
        oauthProviders: [
          {
            provider: "facebook",
            providerId: fbResponse.id,
            linkedAt: new Date(),
          },
        ],
        derniereConnexion: new Date(),
      });

      if (selectedRole === "candidat") {
        await Candidate.create({
          userId: user._id,
          ...(profilePicture && { profilePicture }),
        });
      }
    }

    const response = await buildUserResponse(user, isNew);
    if (isNew) {
      response.msg = "Compte créé avec succès via Facebook ! 🎉";
      response.needsProfileCompletion = true;
      if (user.role === "recruteur") {
        response.needsCompanySelection = true;
      }
    } else {
      response.msg = "Connexion réussie via Facebook ✅";
    }

    res.json(response);
  } catch (err) {
    console.error("Facebook token login error:", err);
    res.status(500).json({ msg: "Erreur lors de la connexion avec Facebook." });
  }
};

// ═══════════════════════════════════════════════════════════════════════
// Complete recruiter OAuth registration (select/create company)
// ═══════════════════════════════════════════════════════════════════════
export const completeOAuthRecruiterSetup = async (req, res) => {
  try {
    const userId = req.user.id;
    const { companyId, nouveauNomEntreprise, nouveauSiteWeb, position } =
      req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ msg: "Utilisateur introuvable." });
    if (user.role !== "recruteur") {
      return res
        .status(400)
        .json({ msg: "Cette action est réservée aux recruteurs." });
    }

    const existingRecruiter = await Recruiter.findOne({ userId });
    if (existingRecruiter) {
      return res.status(400).json({ msg: "Profil recruteur déjà configuré." });
    }

    const Company = (await import("../models/Company.js")).default;

    let finalCompanyId;
    if (companyId) {
      const comp = await Company.findById(companyId);
      if (!comp)
        return res.status(400).json({ msg: "Entreprise introuvable." });
      finalCompanyId = comp._id;
    } else if (nouveauNomEntreprise) {
      const newComp = await Company.create({
        name: nouveauNomEntreprise,
        website: nouveauSiteWeb || "",
        status: "pending",
      });
      finalCompanyId = newComp._id;
    } else {
      return res.status(400).json({
        msg: "Vous devez sélectionner ou créer une entreprise.",
      });
    }

    await Recruiter.create({
      userId: user._id,
      companyId: finalCompanyId,
      position: position || "Recruteur",
      status: "pending_validation",
      isAdmin: !companyId,
    });

    const token = generateToken(user); // 🆕

    res.json({
      msg: "Profil recruteur configuré avec succès ! En attente de validation.",
      token,
      user: {
        id: user._id,
        nom: user.nom,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerified,
      },
      recruiterStatus: "pending_validation",
    });
  } catch (err) {
    console.error("Complete recruiter setup error:", err);
    res.status(500).json({ msg: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════
// Get linked OAuth providers for current user
// ═══════════════════════════════════════════════════════════════════════
export const getLinkedProviders = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select(
      "oauthProviders hasPassword",
    );
    if (!user) return res.status(404).json({ msg: "Utilisateur introuvable." });

    const providers = (user.oauthProviders || []).map((p) => ({
      provider: p.provider,
      linkedAt: p.linkedAt,
    }));

    res.json({
      providers,
      // 🆕 hasPassword reflète maintenant le vrai état
      hasPassword: !!user.hasPassword,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════
// Unlink an OAuth provider
// ═══════════════════════════════════════════════════════════════════════
export const unlinkProvider = async (req, res) => {
  try {
    const { provider } = req.params;
    const userId = req.user.id;

    if (!["google", "facebook"].includes(provider)) {
      return res.status(400).json({ msg: "Fournisseur invalide." });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ msg: "Utilisateur introuvable." });

    const providerCount = user.oauthProviders?.length || 0;

    // 🆕 Empêcher la dissociation si c'est la seule méthode d'auth.
    //    On vérifie maintenant le VRAI hasPassword (plus fiable).
    if (providerCount <= 1 && !user.hasPassword) {
      return res.status(400).json({
        msg: "Impossible de dissocier le dernier fournisseur. Définissez d'abord un mot de passe.",
      });
    }

    user.oauthProviders = user.oauthProviders.filter(
      (p) => p.provider !== provider,
    );
    await user.save();

    res.json({ msg: `${provider} dissocié avec succès.` });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export default {
  googleTokenLogin,
  facebookTokenLogin,
  oauthCallbackHandler,
  completeOAuthRecruiterSetup,
  getLinkedProviders,
  unlinkProvider,
};
