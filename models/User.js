import mongoose from "mongoose";

const oauthProviderSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: ["google", "facebook"],
      required: true,
    },
    providerId: {
      type: String,
      required: true,
    },
    linkedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    nom: { type: String },
    email: { type: String, required: true, unique: true },
    motDePasse: { type: String, required: true },
    role: {
      type: String,
      enum: ["candidat", "recruteur", "admin"],
      required: true,
    },

    emailVerified: {
      type: Boolean,
      default: false,
    },

    accountStatus: {
      type: String,
      enum: ["active", "suspended", "banned"],
      default: "active",
    },
    suspensionReason: String,
    suspendedUntil: Date,

    derniereConnexion: Date,

    // OAuth providers linked to this account
    oauthProviders: [oauthProviderSchema],
  },
  { timestamps: true },
);

userSchema.index({ role: 1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ accountStatus: 1 });
userSchema.index({
  "oauthProviders.provider": 1,
  "oauthProviders.providerId": 1,
});
userSchema.index({ derniereConnexion: 1 });

userSchema.methods.canLogin = function () {
  if (this.accountStatus === "banned") return false;
  if (this.accountStatus === "suspended") {
    if (this.suspendedUntil && new Date() > this.suspendedUntil) {
      return true;
    }
    return false;
  }
  return true;
};

userSchema.methods.hasOAuthProvider = function (provider) {
  return this.oauthProviders?.some((p) => p.provider === provider) || false;
};

userSchema.methods.hasPassword = function () {
  // If user signed up via OAuth, they have a random password they don't know.
  // We check if any OAuth provider is linked — if so, password may be random.
  // This is useful for the frontend to know whether to show "change password" vs "set password".
  return !this.oauthProviders || this.oauthProviders.length === 0;
};

export default mongoose.model("User", userSchema);
