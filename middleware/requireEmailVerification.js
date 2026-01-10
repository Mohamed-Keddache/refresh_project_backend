import User from "../models/User.js";

export const requireEmailVerification = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ msg: "Utilisateur non authentifié." });
  }

  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ msg: "Utilisateur introuvable." });
    }

    if (!user.emailVerified) {
      return res.status(403).json({
        msg: "Veuillez confirmer votre adresse e-mail pour effectuer cette action.",
        code: "EMAIL_NOT_VERIFIED",
      });
    }
    next();
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};
