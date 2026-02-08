import mongoose from "mongoose";

const educationSchema = new mongoose.Schema({
  institut: { type: String, required: true },
  degree: { type: String, required: true },
  fieldOfStudy: { type: String },
  startDate: { type: Date },
  endDate: { type: Date },
  description: { type: String },
});

const experienceSchema = new mongoose.Schema({
  jobTitle: { type: String, required: true },
  company: { type: String, required: true },
  startDate: { type: Date },
  endDate: { type: Date },
  description: { type: String },
});

const skillSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, lowercase: true },
  level: {
    type: String,
    enum: ["beginner", "intermediate", "expert"],
    default: "beginner",
  },
  // Domain can be null for proposed skills
  domain: { type: String, default: null, trim: true },
  // Reference to official skill if it exists
  skillId: { type: mongoose.Schema.Types.ObjectId, ref: "Skill" },
  // True if this was a custom proposed skill
  isProposed: { type: Boolean, default: false },
});

const candidateSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },

    dateOfBirth: { type: Date },
    bio: { type: String, maxLength: 1000 },
    gender: {
      type: String,
      enum: ["homme", "femme"],
    },

    residence: {
      wilaya: { type: String },
      commune: { type: String },
      address: { type: String },
    },

    searchPreferences: {
      wilayas: [{ type: String }],
      remoteOnly: { type: Boolean, default: false },
      willingToRelocate: { type: Boolean, default: false },
    },

    desiredPosition: { type: String },

    desiredJobTypes: [
      {
        type: String,
        enum: [
          "full-time",
          "part-time",
          "remote",
          "internship",
          "freelance",
          "CDI",
          "CDD",
        ],
      },
    ],

    profilePicture: { type: String },
    telephone: { type: String },
    links: {
      website: { type: String },
      linkedin: { type: String },
      github: { type: String },
      portfolio: { type: String },
    },

    autoriserProposition: { type: Boolean, default: true },

    favoris: [
      {
        offerId: { type: mongoose.Schema.Types.ObjectId, ref: "Offer" },
        savedAt: { type: Date, default: Date.now },
      },
    ],

    cvs: [
      {
        url: { type: String, required: true },
        dateDepot: { type: Date, default: Date.now },
        score: { type: Number, default: 0 },
      },
    ],

    skills: [skillSchema],
    experiences: [experienceSchema],
    education: [educationSchema],
  },
  { timestamps: true },
);
candidateSchema.index({ userId: 1 });
candidateSchema.index({ "residence.wilaya": 1 });
candidateSchema.index({ autoriserProposition: 1 });
export default mongoose.model("Candidate", candidateSchema);
