// models/User.js
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const oauthProviderSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ["google", "facebook"], required: true },
    providerId: { type: String, required: true },
    linkedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    nom: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    motDePasse: { type: String, required: true },

    // 🆕 Indique si l'utilisateur a réellement défini un mot de passe.
    //    false  → compte OAuth uniquement (mot de passe aléatoire généré)
    //    true   → l'utilisateur peut se connecter en email + mot de passe
    hasPassword: { type: Boolean, default: false },

    // 🆕 Compteur d'invalidation globale des sessions.
    //    Chaque JWT embarque cette valeur ; si on l'incrémente, tous les
    //    anciens tokens deviennent invalides.
    tokenVersion: { type: Number, default: 0 },

    role: {
      type: String,
      enum: ["candidat", "recruteur", "admin"],
      default: "candidat",
    },

    emailVerified: { type: Boolean, default: false },
    emailVerificationCode: { type: String },
    emailVerificationExpires: { type: Date },

    // OAuth providers liés
    oauthProviders: { type: [oauthProviderSchema], default: [] },

    // Statut du compte
    accountStatus: {
      type: String,
      enum: ["active", "suspended", "banned"],
      default: "active",
    },
    suspensionReason: String,
    bannedAt: Date,

    // Reset password
    resetPasswordCode: String,
    resetPasswordExpires: Date,
    resetPasswordToken: String,
    resetPasswordTokenExpires: Date,

    derniereConnexion: Date,
    profilePicture: String,
    telephone: String,
    wilaya: String,

    statutValidation: {
      type: String,
      enum: ["en_attente", "validé", "refusé"],
      default: "en_attente",
    },
  },
  { timestamps: true },
);

// ─── Hash password avant sauvegarde ────────────────────────────────────
userSchema.pre("save", async function (next) {
  if (!this.isModified("motDePasse")) return next();
  // Si le mot de passe est déjà hashé (commence par $2), on n'y touche pas
  if (this.motDePasse && this.motDePasse.startsWith("$2")) return next();
  this.motDePasse = await bcrypt.hash(this.motDePasse, 12);
  next();
});

// ─── Méthodes d'instance ───────────────────────────────────────────────
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.motDePasse);
};

userSchema.methods.canLogin = function () {
  return this.accountStatus === "active";
};

// 🆕 Incrémente la version du token → invalide toutes les sessions actives
userSchema.methods.incrementTokenVersion = async function () {
  this.tokenVersion = (this.tokenVersion || 0) + 1;
  await this.save();
  return this.tokenVersion;
};

const User = mongoose.models.User || mongoose.model("User", userSchema);
export default User;
