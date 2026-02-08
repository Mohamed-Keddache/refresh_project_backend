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

// Get a setting with default value
systemSettingsSchema.statics.getSetting = async function (
  key,
  defaultValue = null,
) {
  const setting = await this.findOne({ key });
  return setting ? setting.value : defaultValue;
};

// Set a setting
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

// Initialize default settings
systemSettingsSchema.statics.initializeDefaults = async function () {
  const defaults = [
    {
      key: "email_verification_mode",
      value: process.env.NODE_ENV === "production" ? "smtp" : "development",
      description:
        "Mode de vérification email: 'smtp' pour production, 'development' pour code statique 123456",
    },
    {
      key: "skill_proposal_enabled",
      value: true,
      description: "Permet aux candidats de proposer de nouvelles compétences",
    },
    {
      key: "max_cv_per_candidate",
      value: 3,
      description: "Nombre maximum de CV par candidat",
    },
    {
      key: "verification_code_expiry_minutes",
      value: 15,
      description: "Durée de validité du code de vérification en minutes",
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
