// utils/generateToken.js
import jwt from "jsonwebtoken";

/**
 * Génère un JWT contenant tokenVersion pour permettre
 * l'invalidation globale des sessions (logout all devices).
 */
export const generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
      emailVerified: user.emailVerified,
      tokenVersion: user.tokenVersion || 0, // 🆕 essentiel pour l'invalidation
    },
    process.env.JWT_SECRET,
    { expiresIn: "1d" },
  );
};

export default generateToken;
