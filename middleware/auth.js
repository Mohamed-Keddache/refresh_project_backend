// middlewares/auth.js
import jwt from "jsonwebtoken";
import User from "../models/User.js";

/**
 * Middleware d'authentification.
 *
 * 🆕 Vérifie en plus que `tokenVersion` du JWT correspond à celui en DB.
 *    Si l'utilisateur a fait un "logout all devices" ou changé son mot de
 *    passe avec déconnexion globale, son tokenVersion en DB a été
 *    incrémenté → tous les anciens tokens sont invalidés.
 */
export const protect = async (req, res, next) => {
  try {
    let token;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer ")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({ msg: "Non autorisé. Token manquant." });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ msg: "Token invalide ou expiré." });
    }

    // Récupération de l'utilisateur
    const user = await User.findById(decoded.id).select(
      "_id role emailVerified accountStatus tokenVersion nom email",
    );

    if (!user) {
      return res.status(401).json({ msg: "Utilisateur introuvable." });
    }

    // 🆕 Vérification de la version du token
    const currentVersion = user.tokenVersion || 0;
    const tokenVersion = decoded.tokenVersion || 0;
    if (tokenVersion !== currentVersion) {
      return res.status(401).json({
        msg: "Session expirée. Veuillez vous reconnecter.",
        code: "TOKEN_REVOKED",
      });
    }

    // Vérification du statut du compte
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

    req.user = {
      id: user._id,
      _id: user._id,
      role: user.role,
      emailVerified: user.emailVerified,
      tokenVersion: user.tokenVersion,
      nom: user.nom,
      email: user.email,
    };

    next();
  } catch (err) {
    console.error("Auth middleware error:", err);
    res.status(500).json({ msg: "Erreur d'authentification." });
  }
};

// Restrict to specific roles
export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ msg: "Accès non autorisé." });
    }
    next();
  };
};

export default protect;
