// models/SystemSettings.js
import mongoose from "mongoose";

const systemSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    description: {
      type: String,
    },
    category: {
      type: String,
      enum: [
        "general",
        "email",
        "skills",
        "candidates",
        "recruiters",
        "security",
      ],
      default: "general",
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

systemSettingsSchema.statics.getSetting = async function (
  key,
  defaultValue = null,
) {
  const setting = await this.findOne({ key });
  return setting ? setting.value : defaultValue;
};

systemSettingsSchema.statics.setSetting = async function (
  key,
  value,
  description = null,
  updatedBy = null,
) {
  const update = { value, updatedAt: new Date() };
  if (description) update.description = description;
  if (updatedBy) update.updatedBy = updatedBy;

  return this.findOneAndUpdate(
    { key },
    { $set: update, $setOnInsert: { key } },
    { upsert: true, new: true },
  );
};

systemSettingsSchema.statics.getMultipleSettings = async function (keys) {
  const settings = await this.find({ key: { $in: keys } });
  const map = {};
  settings.forEach((s) => {
    map[s.key] = s.value;
  });
  return map;
};

systemSettingsSchema.statics.getSettingsByCategory = async function (category) {
  return this.find({ category }).select("-__v").lean();
};

systemSettingsSchema.statics.initializeDefaults = async function () {
  const defaults = [
    // General
    {
      key: "email_verification_mode",
      value: process.env.NODE_ENV === "production" ? "smtp" : "development",
      description:
        "Mode de vérification email: 'smtp' pour production, 'development' pour code statique 123456",
      category: "email",
    },
    {
      key: "verification_code_expiry_minutes",
      value: 15,
      description: "Durée de validité du code de vérification en minutes",
      category: "email",
    },

    // Candidate settings
    {
      key: "max_cv_per_candidate",
      value: 3,
      description: "Nombre maximum de CV par candidat",
      category: "candidates",
    },

    // Skill system settings
    {
      key: "skill_system_enabled",
      value: true,
      description: "Active ou désactive tout le système de compétences",
      category: "skills",
    },
    {
      key: "max_skills_per_candidate",
      value: 6,
      description: "Nombre maximum de compétences par candidat",
      category: "skills",
    },
    {
      key: "skill_proposal_enabled",
      value: true,
      description:
        "Permet aux candidats d'ajouter des compétences en texte libre (non officielles)",
      category: "skills",
    },
    {
      key: "skill_suggestions_enabled",
      value: true,
      description:
        "Active les suggestions de compétences similaires lors de la saisie",
      category: "skills",
    },
    {
      key: "skill_suggestion_threshold",
      value: 0.6,
      description:
        "Seuil de confiance (0-1) pour afficher des suggestions de compétences similaires",
      category: "skills",
    },
    {
      key: "skill_level_enabled",
      value: true,
      description:
        "Permet aux candidats de définir un niveau pour chaque compétence",
      category: "skills",
    },
    {
      key: "skill_feedback_enabled",
      value: true,
      description:
        "Permet aux candidats de signaler un mapping incorrect de compétence",
      category: "skills",
    },
    {
      key: "skill_feedback_max_per_week",
      value: 3,
      description:
        "Nombre maximum de feedbacks de compétences par candidat par semaine",
      category: "skills",
    },
    {
      key: "skill_feedback_max_per_skill",
      value: 1,
      description:
        "Nombre maximum de feedbacks actifs par compétence par candidat",
      category: "skills",
    },
    {
      key: "skill_abuse_detection_enabled",
      value: true,
      description:
        "Active la détection automatique de compétences abusives/spam",
      category: "skills",
    },
    {
      key: "skill_abuse_max_flags_before_hide",
      value: 3,
      description:
        "Nombre de signalements avant de masquer une compétence des recruteurs",
      category: "skills",
    },
    {
      key: "skill_auto_migration_enabled",
      value: true,
      description:
        "Migration automatique des compétences utilisateur vers les officielles après promotion",
      category: "skills",
    },
    {
      key: "skill_recruiter_search_expand_aliases",
      value: true,
      description:
        "La recherche recruteur inclut les alias et variantes historiques",
      category: "skills",
    },
    {
      key: "skill_trending_window_days",
      value: 30,
      description:
        "Fenêtre en jours pour le calcul des compétences tendance (admin dashboard)",
      category: "skills",
    },
  ];

  for (const setting of defaults) {
    const exists = await this.findOne({ key: setting.key });
    if (!exists) {
      await this.create(setting);
    }
  }
};

export default mongoose.model("SystemSettings", systemSettingsSchema);
