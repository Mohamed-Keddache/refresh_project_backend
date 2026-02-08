// === models/VerificationToken.js ===
import mongoose from "mongoose";
import crypto from "crypto";

const verificationTokenSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  token: {
    type: String,
    required: true,
  },
  code: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: ["email_verification", "password_reset"],
    default: "email_verification",
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 },
  },
  attempts: {
    type: Number,
    default: 0,
  },
  maxAttempts: {
    type: Number,
    default: 3,
  },
  // Track how many codes were sent for rate limiting
  requestCount: {
    type: Number,
    default: 1,
  },
  lastRequestAt: {
    type: Date,
    default: Date.now,
  },
  // For tracking the cooldown window
  cooldownUntil: {
    type: Date,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Generate a 6-digit code
verificationTokenSchema.statics.generateCode = function () {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Generate a secure token
verificationTokenSchema.statics.generateToken = function () {
  return crypto.randomBytes(32).toString("hex");
};

// Create verification token for email verification
verificationTokenSchema.statics.createVerificationToken = async function (
  userId,
  type = "email_verification",
  expiresInMinutes = 15,
) {
  // Delete existing tokens of this type for this user
  await this.deleteMany({ userId, type });

  const code = this.generateCode();
  const token = this.generateToken();

  const verificationToken = await this.create({
    userId,
    token,
    code,
    type,
    expiresAt: new Date(Date.now() + expiresInMinutes * 60 * 1000),
  });

  return { code, token, expiresAt: verificationToken.expiresAt };
};

// Create or update password reset token with rate limiting
verificationTokenSchema.statics.createPasswordResetToken = async function (
  userId,
  expiresInMinutes = 20,
) {
  const MAX_REQUESTS = 3;
  const COOLDOWN_MINUTES = 5;
  const LOCKOUT_MINUTES = 30;

  // Find existing token for this user
  const existingToken = await this.findOne({ userId, type: "password_reset" });

  const now = new Date();

  if (existingToken) {
    // Check if user is in lockout period (sent max codes)
    if (existingToken.cooldownUntil && existingToken.cooldownUntil > now) {
      const waitMinutes = Math.ceil(
        (existingToken.cooldownUntil - now) / (60 * 1000),
      );
      return {
        success: false,
        error: `Trop de demandes. Veuillez attendre ${waitMinutes} minute(s) avant de réessayer.`,
        retryAfter: existingToken.cooldownUntil,
      };
    }

    // Check cooldown between requests (5 minutes)
    const timeSinceLastRequest = now - existingToken.lastRequestAt;
    const cooldownMs = COOLDOWN_MINUTES * 60 * 1000;

    if (timeSinceLastRequest < cooldownMs) {
      const waitSeconds = Math.ceil((cooldownMs - timeSinceLastRequest) / 1000);
      const waitMinutes = Math.ceil(waitSeconds / 60);
      return {
        success: false,
        error: `Veuillez attendre ${waitMinutes} minute(s) avant de demander un nouveau code.`,
        retryAfter: new Date(
          existingToken.lastRequestAt.getTime() + cooldownMs,
        ),
      };
    }

    // Check if max requests reached
    if (existingToken.requestCount >= MAX_REQUESTS) {
      // Set lockout period
      existingToken.cooldownUntil = new Date(
        now.getTime() + LOCKOUT_MINUTES * 60 * 1000,
      );
      existingToken.requestCount = 0; // Reset for next cycle
      await existingToken.save();

      return {
        success: false,
        error: `Nombre maximum de demandes atteint. Veuillez attendre ${LOCKOUT_MINUTES} minutes.`,
        retryAfter: existingToken.cooldownUntil,
      };
    }

    // Update existing token with new code
    const newCode = this.generateCode();
    existingToken.code = newCode;
    existingToken.token = this.generateToken();
    existingToken.expiresAt = new Date(
      now.getTime() + expiresInMinutes * 60 * 1000,
    );
    existingToken.attempts = 0; // Reset attempts for new code
    existingToken.requestCount += 1;
    existingToken.lastRequestAt = now;
    existingToken.cooldownUntil = null;

    await existingToken.save();

    return {
      success: true,
      code: newCode,
      token: existingToken.token,
      expiresAt: existingToken.expiresAt,
      requestsRemaining: MAX_REQUESTS - existingToken.requestCount,
    };
  }

  // Create new token
  const code = this.generateCode();
  const token = this.generateToken();

  const verificationToken = await this.create({
    userId,
    token,
    code,
    type: "password_reset",
    expiresAt: new Date(now.getTime() + expiresInMinutes * 60 * 1000),
    requestCount: 1,
    lastRequestAt: now,
  });

  return {
    success: true,
    code,
    token: verificationToken.token,
    expiresAt: verificationToken.expiresAt,
    requestsRemaining: MAX_REQUESTS - 1,
  };
};

// Verify code with attempt tracking
verificationTokenSchema.statics.verifyCode = async function (
  userId,
  code,
  type = "email_verification",
) {
  const verificationToken = await this.findOne({
    userId,
    type,
    expiresAt: { $gt: new Date() },
  });

  if (!verificationToken) {
    return {
      valid: false,
      error: "Code expiré ou invalide. Demandez un nouveau code.",
    };
  }

  if (verificationToken.attempts >= verificationToken.maxAttempts) {
    await verificationToken.deleteOne();
    return {
      valid: false,
      error: "Trop de tentatives incorrectes. Demandez un nouveau code.",
      locked: true,
    };
  }

  if (verificationToken.code !== code) {
    verificationToken.attempts += 1;
    await verificationToken.save();
    const remaining =
      verificationToken.maxAttempts - verificationToken.attempts;

    if (remaining === 0) {
      await verificationToken.deleteOne();
      return {
        valid: false,
        error:
          "Code incorrect. Le code a été invalidé. Demandez un nouveau code.",
        attemptsRemaining: 0,
        locked: true,
      };
    }

    return {
      valid: false,
      error: `Code incorrect. ${remaining} tentative(s) restante(s).`,
      attemptsRemaining: remaining,
    };
  }

  // For password reset, return token for the next step (don't delete yet)
  if (type === "password_reset") {
    return {
      valid: true,
      token: verificationToken.token,
      userId: verificationToken.userId,
    };
  }

  // For email verification, delete the token
  await verificationToken.deleteOne();
  return { valid: true };
};

// Verify token and code together for password reset final step
verificationTokenSchema.statics.verifyResetToken = async function (token) {
  const verificationToken = await this.findOne({
    token,
    type: "password_reset",
    expiresAt: { $gt: new Date() },
  });

  if (!verificationToken) {
    return {
      valid: false,
      error: "Lien de réinitialisation invalide ou expiré.",
    };
  }

  return {
    valid: true,
    userId: verificationToken.userId,
  };
};

// Consume the token after successful password reset
verificationTokenSchema.statics.consumeResetToken = async function (token) {
  const result = await this.deleteOne({ token, type: "password_reset" });
  return result.deletedCount > 0;
};

export default mongoose.model("VerificationToken", verificationTokenSchema);
