// models/Candidate.js
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
  rawText: {
    type: String,
    required: true,
    trim: true,
  },
  normalizedText: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
  },
  level: {
    type: String,
    enum: ["beginner", "intermediate", "expert", "unset"],
    default: "unset",
  },
  officialSkillId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Skill",
    default: null,
  },
  officialSkillName: {
    type: String,
    default: null,
  },
  domain: {
    type: String,
    default: null,
    trim: true,
  },
  subDomain: {
    type: String,
    default: null,
    trim: true,
  },
  clusterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "SkillCluster",
    default: null,
  },
  matchType: {
    type: String,
    enum: ["exact", "alias", "promoted", "unmatched"],
    default: "unmatched",
  },
  isVisibleToRecruiters: {
    type: Boolean,
    default: true,
  },
  isFlagged: {
    type: Boolean,
    default: false,
  },
  flagReason: {
    type: String,
  },
  addedAt: {
    type: Date,
    default: Date.now,
  },
  mappingHistory: [
    {
      previousOfficialId: { type: mongoose.Schema.Types.ObjectId },
      previousOfficialName: { type: String },
      newOfficialId: { type: mongoose.Schema.Types.ObjectId },
      newOfficialName: { type: String },
      reason: { type: String },
      migratedAt: { type: Date, default: Date.now },
    },
  ],
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
    // ANEM section
    anem: {
      registrationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "CandidateAnemRegistration",
      },
      status: {
        type: String,
        enum: [
          "not_started",
          "draft",
          "pending",
          "pending_verification",
          "in_progress",
          "registered",
          "failed",
          "rejected",
        ],
        default: "not_started",
      },
      anemId: { type: String },
      registeredAt: { type: Date },
      hasSeenAnemInfo: { type: Boolean, default: false },
      declinedAnem: { type: Boolean, default: false },
      declinedAt: { type: Date },
      lastStatusUpdate: { type: Date },
    },

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

    skillTrustScore: {
      type: Number,
      default: 100,
      min: 0,
      max: 100,
    },
  },
  { timestamps: true },
);

candidateSchema.index({ userId: 1 });
candidateSchema.index({ "residence.wilaya": 1 });
candidateSchema.index({ autoriserProposition: 1 });
candidateSchema.index({ "skills.officialSkillId": 1 });
candidateSchema.index({ "skills.normalizedText": 1 });
candidateSchema.index({ "skills.isVisibleToRecruiters": 1 });
candidateSchema.index({ "skills.domain": 1 });

export default mongoose.model("Candidate", candidateSchema);
