import helmet from "helmet";
import mongoSanitize from "express-mongo-sanitize";

const rateLimitStore = new Map();

const createRateLimiter = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000,
    max = 100,
    message = "Trop de requêtes, veuillez réessayer plus tard.",
    keyGenerator = (req) => req.ip,
  } = options;

  setInterval(() => {
    const now = Date.now();
    for (const [key, data] of rateLimitStore.entries()) {
      if (now - data.startTime > windowMs) {
        rateLimitStore.delete(key);
      }
    }
  }, windowMs);

  return (req, res, next) => {
    const key = keyGenerator(req);
    const now = Date.now();

    let record = rateLimitStore.get(key);

    if (!record || now - record.startTime > windowMs) {
      record = { count: 1, startTime: now };
      rateLimitStore.set(key, record);
    } else {
      record.count++;
    }

    res.setHeader("X-RateLimit-Limit", max);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, max - record.count));
    res.setHeader(
      "X-RateLimit-Reset",
      new Date(record.startTime + windowMs).toISOString(),
    );

    if (record.count > max) {
      return res.status(429).json({
        msg: message,
        retryAfter: Math.ceil((record.startTime + windowMs - now) / 1000),
      });
    }

    next();
  };
};

// ══════════════════════════════════════════════════════════════
// FEATURE 4.3: Rate limits renforcés pour la production
// Les limites restent raisonnables pour ne pas bloquer
// les utilisateurs légitimes.
// ══════════════════════════════════════════════════════════════

const isProduction = process.env.NODE_ENV === "production";

export const passwordResetLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: isProduction ? 3 : 5,
  message: "Trop de demandes de réinitialisation. Réessayez dans 1 heure.",
  keyGenerator: (req) => `pwdreset:${req.ip}`,
});

export const passwordResetVerifyLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 5 : 10,
  message: "Trop de tentatives de vérification. Réessayez dans 15 minutes.",
  keyGenerator: (req) => `pwdverify:${req.ip}`,
});

export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 7 : 10,
  message: "Trop de tentatives de connexion. Réessayez dans 15 minutes.",
  keyGenerator: (req) => `auth:${req.ip}`,
});

export const emailVerificationLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 3,
  message: "Trop de demandes de vérification. Réessayez dans 1 minute.",
  keyGenerator: (req) => `email:${req.user?.id || req.ip}`,
});

export const uploadRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: isProduction ? 5 : 10,
  message: "Trop de téléchargements. Réessayez dans 1 minute.",
  keyGenerator: (req) => `upload:${req.user?.id || req.ip}`,
});

export const generalRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 150 : 200,
});

export const offerCreationLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: isProduction ? 5 : 10,
  message: "Trop d'offres créées. Réessayez dans 1 heure.",
  keyGenerator: (req) => `offer:${req.user?.id || req.ip}`,
});

export const applicationLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: isProduction ? 15 : 20,
  message: "Trop de candidatures envoyées. Réessayez dans 1 heure.",
  keyGenerator: (req) => `apply:${req.user?.id || req.ip}`,
});

export const messageLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: isProduction ? 20 : 30,
  message: "Trop de messages envoyés. Réessayez dans 1 minute.",
  keyGenerator: (req) => `msg:${req.user?.id || req.ip}`,
});

export const setupSecurity = (app) => {
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(mongoSanitize());

  app.use(generalRateLimiter);
};

export default {
  setupSecurity,
  authRateLimiter,
  emailVerificationLimiter,
  uploadRateLimiter,
};
