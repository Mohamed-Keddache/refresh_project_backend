import "dotenv/config"; // Added this to explicitly load .env before passport reads process.env
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as FacebookStrategy } from "passport-facebook";
import User from "../models/User.js";
import Candidate from "../models/Candidate.js";

console.log("🔑 PASSPORT ENV CHECK:", {
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ? "SET" : "NOT SET",
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ? "SET" : "NOT SET",
  FACEBOOK_APP_ID: process.env.FACEBOOK_APP_ID ? "SET" : "NOT SET",
  FACEBOOK_APP_SECRET: process.env.FACEBOOK_APP_SECRET ? "SET" : "NOT SET",
});

passport.serializeUser((user, done) => {
  done(null, user._id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${process.env.BACKEND_URL || "http://localhost:5000"}/api/auth/google/callback`,
        scope: ["profile", "email"],
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const result = await handleOAuthUser(profile, "google");
          done(null, result);
        } catch (err) {
          done(err, null);
        }
      },
    ),
  );
  console.log("✅ Google OAuth strategy configured");
} else {
  console.warn(
    "⚠️ Google OAuth not configured (missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET)",
  );
}

if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
  passport.use(
    new FacebookStrategy(
      {
        clientID: process.env.FACEBOOK_APP_ID,
        clientSecret: process.env.FACEBOOK_APP_SECRET,
        callbackURL: `${process.env.BACKEND_URL || "http://localhost:5000"}/api/auth/facebook/callback`,
        profileFields: ["id", "emails", "name", "displayName", "photos"],
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const result = await handleOAuthUser(profile, "facebook");
          done(null, result);
        } catch (err) {
          done(err, null);
        }
      },
    ),
  );
  console.log("✅ Facebook OAuth strategy configured");
} else {
  console.warn(
    "⚠️ Facebook OAuth not configured (missing FACEBOOK_APP_ID or FACEBOOK_APP_SECRET)",
  );
}

async function handleOAuthUser(profile, provider) {
  const email =
    profile.emails && profile.emails.length > 0
      ? profile.emails[0].value.toLowerCase()
      : null;

  if (!email) {
    throw new Error(
      `Aucun email fourni par ${provider}. Veuillez autoriser l'accès à votre email.`,
    );
  }

  const displayName =
    profile.displayName ||
    `${profile.name?.givenName || ""} ${profile.name?.familyName || ""}`.trim() ||
    email.split("@")[0];

  const profilePicture =
    profile.photos && profile.photos.length > 0
      ? profile.photos[0].value
      : null;

  let user = await User.findOne({ email });

  if (user) {
    let updated = false;

    if (!user.oauthProviders) {
      user.oauthProviders = [];
    }

    const existingProvider = user.oauthProviders.find(
      (p) => p.provider === provider,
    );

    if (!existingProvider) {
      user.oauthProviders.push({
        provider,
        providerId: profile.id,
        linkedAt: new Date(),
      });
      updated = true;
    }

    if (!user.emailVerified) {
      user.emailVerified = true;
      updated = true;
    }

    if (updated) {
      await user.save();
    }

    if (!user.canLogin()) {
      const error = new Error("ACCOUNT_RESTRICTED");
      error.accountStatus = user.accountStatus;
      error.suspensionReason = user.suspensionReason;
      error.suspendedUntil = user.suspendedUntil;
      throw error;
    }

    user.derniereConnexion = new Date();
    await user.save();

    return { user, isNew: false };
  }

  const crypto = await import("crypto");
  const randomPassword = crypto.randomBytes(32).toString("hex");
  const bcrypt = await import("bcryptjs");
  const hashedPassword = await bcrypt.default.hash(randomPassword, 12);

  user = await User.create({
    nom: displayName,
    email,
    motDePasse: hashedPassword,
    role: "candidat",
    emailVerified: true,
    accountStatus: "active",
    oauthProviders: [
      {
        provider,
        providerId: profile.id,
        linkedAt: new Date(),
      },
    ],
    derniereConnexion: new Date(),
  });

  const candidateData = { userId: user._id };

  if (profilePicture) {
    candidateData.profilePicture = profilePicture;
  }

  await Candidate.create(candidateData);

  return { user, isNew: true, profilePicture };
}

export default passport;
