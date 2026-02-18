import Candidate from "../models/Candidate.js";
import Offer from "../models/Offer.js";
import User from "../models/User.js";
import Application from "../models/Application.js";
import Company from "../models/Company.js";
import Skill from "../models/Skills.js";
import ProposedSkill from "../models/ProposedSkill.js";
import SystemSettings from "../models/SystemSettings.js";
import Notification from "../models/Notification.js";
import CandidateAnemRegistration from "../models/CandidateAnemRegistration.js";
import Interview from "../models/Interview.js";
import {
  uploadCV as cloudinaryUploadCV,
  uploadProfileImage,
  deleteFromCloudinary,
  getPublicIdFromUrl,
  deleteMultipleFromCloudinary,
} from "../config/cloudinary.js";
import { calculateProfileCompletion } from "../utils/profileCompletion.js";

import {
  addSkillToCandidate as addSkill,
  updateCandidateSkill as updateSkill,
  deleteCandidateSkill as deleteSkill,
  getSkillDetails,
  submitSkillFeedback,
} from "./skillController.js";

// ============ PROFILE MANAGEMENT ============

export const getProfile = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id })
      .populate("userId", "nom email emailVerified")
      .populate("skills.officialSkillId", "name category");

    if (!candidate) {
      return res.status(404).json({ msg: "Profil introuvable." });
    }

    const user = await User.findById(req.user.id);
    const completion = calculateProfileCompletion(candidate, user);

    res.json({
      profil: candidate,
      completion,
      emailVerified: user.emailVerified,
      anem: {
        status: candidate.anem?.status || "not_started",
        anemId: candidate.anem?.anemId || null,
        isRegistered: candidate.anem?.status === "registered",
      },
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      telephone,
      residence,
      searchPreferences,
      desiredPosition,
      desiredJobTypes,
      dateOfBirth,
      bio,
      gender,
      autoriserProposition,
      links,
    } = req.body;

    let candidate = await Candidate.findOne({ userId });
    if (!candidate) {
      candidate = new Candidate({ userId });
    }

    // Update fields if provided
    if (telephone !== undefined) candidate.telephone = telephone;
    if (residence !== undefined) candidate.residence = residence;
    if (searchPreferences !== undefined)
      candidate.searchPreferences = searchPreferences;
    if (desiredPosition !== undefined)
      candidate.desiredPosition = desiredPosition;
    if (desiredJobTypes !== undefined)
      candidate.desiredJobTypes = desiredJobTypes;
    if (dateOfBirth !== undefined) candidate.dateOfBirth = dateOfBirth;
    if (bio !== undefined) candidate.bio = bio;
    if (gender !== undefined) candidate.gender = gender;
    if (autoriserProposition !== undefined)
      candidate.autoriserProposition = autoriserProposition;
    if (links !== undefined) candidate.links = links;

    await candidate.save();

    const user = await User.findById(userId);
    const completion = calculateProfileCompletion(candidate, user);

    res.json({
      msg: "Profil mis à jour ✅",
      candidate,
      completion,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const updateAccount = async (req, res) => {
  try {
    const userId = req.user.id;
    const { nom, email, motDePasse } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ msg: "Utilisateur introuvable." });
    }

    if (nom) user.nom = nom;

    if (email && email !== user.email) {
      const emailExists = await User.findOne({ email, _id: { $ne: userId } });
      if (emailExists) {
        return res.status(400).json({ msg: "Cet email est déjà utilisé." });
      }
      // Note: In production, you might want to re-verify the new email
      user.email = email;
    }

    if (motDePasse) {
      const bcrypt = await import("bcryptjs");
      user.motDePasse = await bcrypt.default.hash(motDePasse, 10);
    }

    await user.save();
    res.json({ msg: "Compte mis à jour ✅" });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// ============ FILE UPLOADS (CLOUDINARY) ============

export const uploadProfilePicture = async (req, res) => {
  try {
    const userId = req.user.id;
    const candidate = await Candidate.findOne({ userId });

    if (!candidate) {
      return res.status(404).json({ msg: "Profil introuvable." });
    }

    if (!req.file) {
      return res.status(400).json({ msg: "Aucune image fournie." });
    }

    // Delete old profile picture from Cloudinary if exists
    if (candidate.profilePicture) {
      const publicId = getPublicIdFromUrl(candidate.profilePicture);
      if (publicId) {
        await deleteFromCloudinary(publicId, "image");
      }
    }

    // Upload new image to Cloudinary
    const result = await uploadProfileImage(req.file.buffer, userId);

    candidate.profilePicture = result.secure_url;
    await candidate.save();

    res.json({
      msg: "Photo de profil mise à jour 📸",
      profilePicture: candidate.profilePicture,
    });
  } catch (err) {
    console.error("Profile picture upload error:", err);
    res.status(500).json({ msg: "Erreur lors du téléchargement de l'image" });
  }
};

export const uploadCandidateCV = async (req, res) => {
  try {
    const userId = req.user.id;
    const candidate = await Candidate.findOne({ userId });

    if (!candidate) {
      return res.status(404).json({ msg: "Profil introuvable." });
    }

    const maxCVs = await SystemSettings.getSetting("max_cv_per_candidate", 3);
    if (candidate.cvs.length >= maxCVs) {
      return res.status(400).json({
        msg: `Vous ne pouvez pas ajouter plus de ${maxCVs} CV.`,
      });
    }

    if (!req.file) {
      return res.status(400).json({ msg: "Aucun fichier fourni." });
    }

    // Upload CV to Cloudinary
    const result = await cloudinaryUploadCV(
      req.file.buffer,
      req.file.originalname,
      userId,
    );

    // Calculate simple score based on file size
    const fileSize = req.file.size;
    let score = 100;
    if (fileSize < 20 * 1024)
      score = 50; // Too small
    else if (fileSize > 5 * 1024 * 1024) score = 70; // Very large

    candidate.cvs.push({
      url: result.secure_url,
      dateDepot: new Date(),
      score,
    });

    await candidate.save();

    res.json({
      msg: "CV ajouté avec succès ✅",
      cv: {
        _id: candidate.cvs[candidate.cvs.length - 1]._id,
        url: result.secure_url,
        score,
      },
    });
  } catch (err) {
    console.error("CV upload error:", err);
    res.status(500).json({ msg: "Erreur lors du téléchargement du CV" });
  }
};

export const deleteCV = async (req, res) => {
  try {
    const userId = req.user.id;
    const { cvId } = req.params;

    const candidate = await Candidate.findOne({ userId });
    if (!candidate) {
      return res.status(404).json({ msg: "Profil introuvable." });
    }

    const cv = candidate.cvs.id(cvId);
    if (!cv) {
      return res.status(404).json({ msg: "CV introuvable." });
    }

    // Delete from Cloudinary
    const publicId = getPublicIdFromUrl(cv.url);
    if (publicId) {
      await deleteFromCloudinary(publicId, "raw");
    }

    candidate.cvs.pull(cvId);
    await candidate.save();

    res.json({
      msg: "CV supprimé avec succès 🗑️",
      cvs: candidate.cvs,
    });
  } catch (err) {
    console.error("CV deletion error:", err);
    res.status(500).json({ msg: err.message });
  }
};

// ============ SKILLS MANAGEMENT ============

// ============ EXPERIENCE MANAGEMENT ============

export const addExperience = async (req, res) => {
  try {
    const userId = req.user.id;
    const { jobTitle, company, startDate, endDate, description } = req.body;

    const candidate = await Candidate.findOne({ userId });
    if (!candidate) {
      return res.status(404).json({ msg: "Profil introuvable." });
    }

    candidate.experiences.push({
      jobTitle,
      company,
      startDate,
      endDate: endDate || null,
      description,
    });

    await candidate.save();

    res.json({ msg: "Expérience ajoutée", experiences: candidate.experiences });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const updateExperience = async (req, res) => {
  try {
    const userId = req.user.id;
    const { experienceId } = req.params;
    const { jobTitle, company, startDate, endDate, description } = req.body;

    const candidate = await Candidate.findOne({ userId });
    if (!candidate) {
      return res.status(404).json({ msg: "Profil introuvable." });
    }

    const experience = candidate.experiences.id(experienceId);
    if (!experience) {
      return res.status(404).json({ msg: "Expérience introuvable." });
    }

    if (jobTitle) experience.jobTitle = jobTitle;
    if (company) experience.company = company;
    if (startDate) experience.startDate = startDate;
    if (endDate !== undefined) experience.endDate = endDate;
    if (description !== undefined) experience.description = description;

    await candidate.save();

    res.json({
      msg: "Expérience mise à jour",
      experiences: candidate.experiences,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const deleteExperience = async (req, res) => {
  try {
    const userId = req.user.id;
    const { experienceId } = req.params;

    const candidate = await Candidate.findOne({ userId });
    if (!candidate) {
      return res.status(404).json({ msg: "Profil introuvable." });
    }

    candidate.experiences.pull(experienceId);
    await candidate.save();

    res.json({
      msg: "Expérience supprimée",
      experiences: candidate.experiences,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// ============ EDUCATION MANAGEMENT ============

export const addEducation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { institut, degree, fieldOfStudy, startDate, endDate, description } =
      req.body;

    const candidate = await Candidate.findOne({ userId });
    if (!candidate) {
      return res.status(404).json({ msg: "Profil introuvable." });
    }

    candidate.education.push({
      institut,
      degree,
      fieldOfStudy,
      startDate,
      endDate: endDate || null,
      description,
    });

    await candidate.save();

    res.json({
      msg: "Formation ajoutée avec succès 🎓",
      education: candidate.education,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const updateEducation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { educationId } = req.params;
    const { institut, degree, fieldOfStudy, startDate, endDate, description } =
      req.body;

    const candidate = await Candidate.findOne({ userId });
    if (!candidate) {
      return res.status(404).json({ msg: "Profil introuvable." });
    }

    const edu = candidate.education.id(educationId);
    if (!edu) {
      return res.status(404).json({ msg: "Formation introuvable." });
    }

    if (institut) edu.institut = institut;
    if (degree) edu.degree = degree;
    if (fieldOfStudy !== undefined) edu.fieldOfStudy = fieldOfStudy;
    if (startDate) edu.startDate = startDate;
    if (endDate !== undefined) edu.endDate = endDate;
    if (description !== undefined) edu.description = description;

    await candidate.save();

    res.json({
      msg: "Formation mise à jour ✅",
      education: candidate.education,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const deleteEducation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { educationId } = req.params;

    const candidate = await Candidate.findOne({ userId });
    if (!candidate) {
      return res.status(404).json({ msg: "Profil introuvable." });
    }

    candidate.education.pull(educationId);
    await candidate.save();

    res.json({ msg: "Formation supprimée 🗑️", education: candidate.education });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// ============ FAVORITES MANAGEMENT ============

export const getFavorites = async (req, res) => {
  try {
    const userId = req.user.id;

    const candidate = await Candidate.findOne({ userId }).populate({
      path: "favoris.offerId",
      select:
        "titre companyId type wilaya salaryMin salaryMax datePublication actif validationStatus",
      populate: {
        path: "companyId",
        select: "name logo location",
      },
    });

    if (!candidate) {
      return res.status(404).json({ msg: "Profil introuvable." });
    }

    // Filter out null offers (deleted) and inactive ones
    const validFavorites = candidate.favoris
      .filter((f) => f.offerId !== null)
      .map((f) => ({
        _id: f._id,
        savedAt: f.savedAt,
        offer: {
          _id: f.offerId._id,
          titre: f.offerId.titre,
          type: f.offerId.type,
          wilaya: f.offerId.wilaya,
          salaryMin: f.offerId.salaryMin,
          salaryMax: f.offerId.salaryMax,
          datePublication: f.offerId.datePublication,
          isActive:
            f.offerId.actif && f.offerId.validationStatus === "approved",
          company: {
            name: f.offerId.companyId?.name,
            logo: f.offerId.companyId?.logo,
            location: f.offerId.companyId?.location,
          },
        },
      }));

    res.json(validFavorites);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const addToFavorites = async (req, res) => {
  try {
    const { offerId } = req.params;
    const userId = req.user.id;

    const offerExists = await Offer.exists({
      _id: offerId,
      actif: true,
      validationStatus: "approved",
    });
    if (!offerExists) {
      return res.status(404).json({ msg: "Offre introuvable ou inactive." });
    }

    const candidateCheck = await Candidate.findOne({
      userId,
      "favoris.offerId": offerId,
    });

    if (candidateCheck) {
      return res
        .status(400)
        .json({ msg: "Cette offre est déjà dans vos favoris." });
    }

    const updatedCandidate = await Candidate.findOneAndUpdate(
      { userId },
      {
        $push: {
          favoris: {
            offerId: offerId,
            savedAt: new Date(),
          },
        },
      },
      { new: true },
    );

    if (!updatedCandidate) {
      return res.status(404).json({ msg: "Profil candidat introuvable." });
    }

    res.json({
      msg: "Offre ajoutée aux favoris ❤️",
      favorisCount: updatedCandidate.favoris.length,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const removeFromFavorites = async (req, res) => {
  try {
    const { offerId } = req.params;
    const userId = req.user.id;

    const updatedCandidate = await Candidate.findOneAndUpdate(
      { userId },
      {
        $pull: {
          favoris: { offerId: offerId },
        },
      },
      { new: true },
    );

    if (!updatedCandidate) {
      return res.status(404).json({ msg: "Profil candidat introuvable." });
    }

    res.json({
      msg: "Offre retirée des favoris 💔",
      favorisCount: updatedCandidate.favoris.length,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// ============ APPLICATION ============

export const applyToOffer = async (req, res) => {
  try {
    const userId = req.user.id;
    const { offreId, cvUrl, coverLetter } = req.body;

    const candidate = await Candidate.findOne({ userId });
    const user = await User.findById(userId);

    if (!candidate) {
      return res.status(404).json({ msg: "Profil introuvable." });
    }

    if (!user.emailVerified) {
      return res.status(403).json({
        msg: "Email non vérifié.",
        code: "EMAIL_NOT_VERIFIED",
      });
    }

    const completion = calculateProfileCompletion(candidate, user);
    if (!completion.canApply) {
      return res.status(400).json({
        msg: "Profil incomplet.",
        missing: completion.missingForApplication,
      });
    }

    const cvExists = candidate.cvs.some((cv) => cv.url === cvUrl);
    if (!cvExists) {
      return res.status(400).json({ msg: "CV invalide." });
    }

    const offer = await Offer.findById(offreId);
    if (!offer || !offer.actif || offer.validationStatus !== "approved") {
      return res
        .status(400)
        .json({ msg: "Cette offre n'est plus disponible." });
    }

    // Check for existing application
    const existingApp = await Application.findOne({
      offerId: offreId,
      candidateId: candidate._id,
    });

    if (existingApp) {
      const activeStatuses = ["envoyee", "en_cours", "retenue", "non_retenue"];

      if (activeStatuses.includes(existingApp.candidateStatus)) {
        return res.status(400).json({
          msg: "Vous avez déjà une candidature active pour cette offre.",
        });
      }

      if (["cancelled", "retiree"].includes(existingApp.candidateStatus)) {
        if (offer.allowRepostulation === false) {
          return res.status(403).json({
            msg: "L'employeur n'accepte pas les repostulations pour cette offre.",
          });
        }

        const wasWithdrawn = existingApp.candidateStatus === "retiree";

        existingApp.candidateStatus = "envoyee";
        existingApp.recruiterStatus = "nouvelle";
        existingApp.cvUrl = cvUrl;
        existingApp.coverLetter = coverLetter || "";
        existingApp.seenByRecruiter = false;
        existingApp.seenAt = null;
        existingApp.datePostulation = new Date();
        existingApp.isRepostulation = true;
        existingApp.withdrawReason = undefined;
        existingApp.withdrawnAt = undefined;

        existingApp.statusHistory.push({
          candidateStatus: "envoyee",
          recruiterStatus: "nouvelle",
          changedBy: userId,
          note: wasWithdrawn
            ? "Repostulation après retrait"
            : "Nouvelle postulation après annulation",
        });

        await existingApp.save();

        await Offer.findByIdAndUpdate(offreId, {
          $inc: { nombreCandidatures: 1 },
        });

        return res.json({
          msg: "Candidature envoyée avec succès ✅",
          applicationId: existingApp._id,
          reactivated: true,
        });
      }
    }

    // Create new application
    const company = await Company.findById(offer.companyId);

    const newApplication = await Application.create({
      offerId: offreId,
      candidateId: candidate._id,
      cvUrl,
      coverLetter: coverLetter || "",
      candidateStatus: "envoyee",
      recruiterStatus: "nouvelle",
      source: "direct",
      isRepostulation: false,
      offerSnapshot: {
        titre: offer.titre,
        entrepriseNom: company?.name || "Entreprise",
        companyId: offer.companyId,
        location: offer.wilaya,
        wilaya: offer.wilaya,
        salaryMin: offer.salaryMin,
        salaryMax: offer.salaryMax,
        type: offer.type,
        domaine: offer.domaine,
      },
    });

    await Offer.findByIdAndUpdate(offreId, {
      $inc: { nombreCandidatures: 1 },
    });

    res.json({
      msg: "Candidature envoyée avec succès ✅",
      applicationId: newApplication._id,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// ============ STATISTICS & DASHBOARD ============

export const getCandidateStats = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    if (!candidate) {
      return res.status(404).json({ msg: "Candidat introuvable" });
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [
      totalApplications,
      applicationsByStatus,
      recentApplications,
      weeklyApplications,
      viewedApplications,
      upcomingInterviews,
      pendingInterviewResponses,
    ] = await Promise.all([
      Application.countDocuments({ candidateId: candidate._id }),
      Application.aggregate([
        { $match: { candidateId: candidate._id } },
        { $group: { _id: "$candidateStatus", count: { $sum: 1 } } },
      ]),
      Application.countDocuments({
        candidateId: candidate._id,
        datePostulation: { $gte: thirtyDaysAgo },
      }),
      Application.countDocuments({
        candidateId: candidate._id,
        datePostulation: { $gte: sevenDaysAgo },
      }),
      Application.countDocuments({
        candidateId: candidate._id,
        seenByRecruiter: true,
      }),
      Interview.countDocuments({
        candidateId: candidate._id,
        status: "confirmed",
        scheduledAt: { $gte: new Date() },
      }),
      Interview.countDocuments({
        candidateId: candidate._id,
        status: "proposed",
        scheduledAt: { $gte: new Date() },
      }),
    ]);

    const statusMap = {};
    applicationsByStatus.forEach((item) => {
      statusMap[item._id] = item.count;
    });

    const responded =
      (statusMap["retenue"] || 0) +
      (statusMap["non_retenue"] || 0) +
      (statusMap["en_cours"] || 0);

    const responseRate =
      totalApplications > 0
        ? Math.round((responded / totalApplications) * 100)
        : 0;

    const viewRate =
      totalApplications > 0
        ? Math.round((viewedApplications / totalApplications) * 100)
        : 0;

    const user = await User.findById(req.user.id);
    const profileCompletion = calculateProfileCompletion(candidate, user);

    // Generate smart suggestions
    const suggestions = [];

    if (!user.emailVerified) {
      suggestions.push({
        type: "critical",
        priority: 1,
        message: "Confirmez votre email pour postuler aux offres",
        action: "verify_email",
        icon: "mail",
      });
    }

    if (profileCompletion.percentage < 100) {
      suggestions.push({
        type: "important",
        priority: 2,
        message: `Complétez votre profil (${profileCompletion.percentage}%)`,
        action: "complete_profile",
        missing: profileCompletion.missing,
        icon: "user",
      });
    }

    if (candidate.cvs.length === 0) {
      suggestions.push({
        type: "important",
        priority: 3,
        message: "Ajoutez votre CV pour augmenter vos chances",
        action: "upload_cv",
        icon: "file",
      });
    }

    if (candidate.skills.length < 3) {
      suggestions.push({
        type: "suggestion",
        priority: 4,
        message:
          "Ajoutez plus de compétences pour de meilleures recommandations",
        action: "add_skills",
        icon: "star",
      });
    }

    if (pendingInterviewResponses > 0) {
      suggestions.push({
        type: "urgent",
        priority: 0,
        message: `${pendingInterviewResponses} proposition(s) d'entretien en attente`,
        action: "view_interviews",
        icon: "calendar",
      });
    }

    // Sort suggestions by priority
    suggestions.sort((a, b) => a.priority - b.priority);

    res.json({
      applications: {
        total: totalApplications,
        thisMonth: recentApplications,
        thisWeek: weeklyApplications,
        byStatus: statusMap,
      },
      interviews: {
        upcoming: upcomingInterviews,
        pendingResponse: pendingInterviewResponses,
      },
      favorites: candidate.favoris.length,
      rates: {
        response: responseRate,
        view: viewRate,
      },
      anem: {
        status: candidate.anem?.status || "not_started",
        anemId: candidate.anem?.anemId || null,
        isRegistered: candidate.anem?.status === "registered",
      },
      completion: profileCompletion,
      suggestions,
      cvCount: candidate.cvs.length,
      skillCount: candidate.skills.length,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getActivityTimeline = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    if (!candidate) {
      return res.status(404).json({ msg: "Candidat introuvable" });
    }

    const { limit = 20 } = req.query;

    // Get recent applications
    const recentApplications = await Application.find({
      candidateId: candidate._id,
    })
      .sort({ updatedAt: -1 })
      .limit(parseInt(limit))
      .populate({
        path: "offerId",
        select: "titre",
        populate: { path: "companyId", select: "name logo" },
      })
      .lean();

    // Get recent interviews
    const recentInterviews = await Interview.find({
      candidateId: candidate._id,
    })
      .sort({ updatedAt: -1 })
      .limit(10)
      .populate("offerId", "titre")
      .lean();

    // Combine and sort activities
    const activities = [
      ...recentApplications.map((app) => ({
        type: "application",
        date: app.updatedAt,
        title:
          app.offerId?.titre || app.offerSnapshot?.titre || "Offre supprimée",
        company:
          app.offerId?.companyId?.name || app.offerSnapshot?.entrepriseNom,
        companyLogo: app.offerId?.companyId?.logo,
        status: app.candidateStatus,
        applicationId: app._id,
        icon: getApplicationIcon(app.candidateStatus),
      })),
      ...recentInterviews.map((interview) => ({
        type: "interview",
        date: interview.updatedAt,
        title: interview.offerId?.titre || "Offre supprimée",
        status: interview.status,
        scheduledAt: interview.scheduledAt,
        interviewType: interview.type,
        interviewId: interview._id,
        icon: getInterviewIcon(interview.status),
      })),
    ];

    // Sort by date
    activities.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json(activities.slice(0, parseInt(limit)));
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// Helper functions for icons
function getApplicationIcon(status) {
  const icons = {
    envoyee: "send",
    en_cours: "clock",
    retenue: "check-circle",
    non_retenue: "x-circle",
    retiree: "arrow-left",
    cancelled: "x",
  };
  return icons[status] || "file";
}

function getInterviewIcon(status) {
  const icons = {
    proposed: "calendar-plus",
    confirmed: "calendar-check",
    completed: "check",
    cancelled_by_candidate: "x",
    cancelled_by_recruiter: "x",
  };
  return icons[status] || "calendar";
}

// ============ IMPROVED RECOMMENDATIONS ============

export const getRecommendedOffers = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });

    if (!candidate) {
      return res.status(404).json({ msg: "Profil candidat introuvable" });
    }

    // Get already applied offer IDs
    const appliedOfferIds = await Application.find({
      candidateId: candidate._id,
    }).distinct("offerId");

    // Build base query for active offers
    const baseQuery = {
      actif: true,
      validationStatus: "approved",
      _id: { $nin: appliedOfferIds },
    };

    const candidateSkills = [];

    for (const skill of candidate.skills || []) {
      if (!skill.isVisibleToRecruiters) continue;

      // Add raw normalized text
      if (skill.normalizedText) {
        candidateSkills.push(skill.normalizedText);
      }

      // Add official name if mapped
      if (skill.officialSkillName) {
        candidateSkills.push(skill.officialSkillName.toLowerCase());
      }

      // Add domain for broader matching
      if (skill.domain) {
        candidateSkills.push(skill.domain.toLowerCase());
      }
    }

    const candidateWilaya = candidate.residence?.wilaya;
    const desiredPosition = candidate.desiredPosition?.toLowerCase();
    const desiredJobTypes = candidate.desiredJobTypes || [];

    // If no skills, return offers based on location only
    if (candidateSkills.length === 0 && !candidateWilaya && !desiredPosition) {
      const popularOffers = await Offer.find(baseQuery)
        .populate("companyId", "name logo location")
        .sort({ nombreCandidatures: -1 })
        .limit(10)
        .lean();

      return res.json(
        popularOffers.map((o) => ({
          ...o,
          matchScore: 0,
          matchReasons: ["Offres populaires"],
        })),
      );
    }

    // Build dynamic query
    const queryConditions = [];

    // Skill matching
    if (candidateSkills.length > 0) {
      queryConditions.push({
        skills: {
          $in: candidateSkills.map((s) => new RegExp(s, "i")),
        },
      });
    }

    // Location matching
    if (candidateWilaya) {
      queryConditions.push({ wilaya: candidateWilaya });
    }

    // Position matching
    if (desiredPosition) {
      queryConditions.push({
        titre: { $regex: desiredPosition, $options: "i" },
      });
    }

    // Job type matching
    if (desiredJobTypes.length > 0) {
      queryConditions.push({ type: { $in: desiredJobTypes } });
    }

    // Combine with OR to get broader results, then score them
    let offerQuery = { ...baseQuery };
    if (queryConditions.length > 0) {
      offerQuery.$or = queryConditions;
    }

    const offers = await Offer.find(offerQuery)
      .populate("companyId", "name logo location industry")
      .sort({ datePublication: -1 })
      .limit(50)
      .lean();

    // Score and rank offers
    const scoredOffers = offers.map((offer) => {
      let score = 0;
      const matchReasons = [];

      // Skill matching (40% weight)
      const offerSkills = (offer.skills || []).map((s) =>
        s.trim().toLowerCase(),
      );
      const matchingSkills = offerSkills.filter((skill) =>
        candidateSkills.some((cs) => skill.includes(cs) || cs.includes(skill)),
      );
      if (matchingSkills.length > 0) {
        const skillScore = Math.min(
          (matchingSkills.length / Math.max(offerSkills.length, 1)) * 40,
          40,
        );
        score += skillScore;
        matchReasons.push(
          `${matchingSkills.length} compétence(s) correspondante(s)`,
        );
      }

      // Location matching (25% weight)
      if (candidateWilaya && offer.wilaya === candidateWilaya) {
        score += 25;
        matchReasons.push("Même wilaya");
      }

      // Job type matching (20% weight)
      if (desiredJobTypes.length > 0 && desiredJobTypes.includes(offer.type)) {
        score += 20;
        matchReasons.push("Type de contrat souhaité");
      }

      // Position/title matching (15% weight)
      if (
        desiredPosition &&
        offer.titre.toLowerCase().includes(desiredPosition)
      ) {
        score += 15;
        matchReasons.push("Correspond au poste recherché");
      }

      // Bonus for new offers (last 7 days)
      const isNew =
        new Date() - new Date(offer.datePublication) < 7 * 24 * 60 * 60 * 1000;
      if (isNew) {
        score += 5;
        matchReasons.push("Offre récente");
      }

      return {
        ...offer,
        matchScore: Math.round(score),
        matchReasons,
        matchingSkills,
        isNew,
      };
    });

    // Sort by score, then by date
    scoredOffers.sort((a, b) => {
      if (b.matchScore !== a.matchScore) {
        return b.matchScore - a.matchScore;
      }
      return (
        new Date(b.datePublication).getTime() -
        new Date(a.datePublication).getTime()
      );
    });

    // Return top 10
    res.json(scoredOffers.slice(0, 10));
  } catch (err) {
    console.error("Recommendation error:", err);
    res.status(500).json({ msg: err.message });
  }
};
export {
  addSkill,
  updateSkill,
  deleteSkill,
  getSkillDetails,
  submitSkillFeedback,
};
