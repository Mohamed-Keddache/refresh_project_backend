import Candidate from "../models/Candidate.js";
import Offer from "../models/Offer.js";
import User from "../models/User.js";
import { uploadCV } from "../config/multer.js";
import Recruiter from "../models/Recruiter.js";
import Notification from "../models/Notification.js";
import Application from "../models/Application.js";
import Company from "../models/Company.js";
import fs from "fs";
import path from "path";
import { calculateProfileCompletion } from "../utils/profileCompletion.js";

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
      skills,
      experiences,
      education,
      autoriserProposition,
      links,
    } = req.body;

    let candidate = await Candidate.findOne({ userId });
    if (!candidate) candidate = new Candidate({ userId });

    if (telephone) candidate.telephone = telephone;
    if (residence) candidate.residence = residence;
    if (searchPreferences) candidate.searchPreferences = searchPreferences;
    if (desiredPosition) candidate.desiredPosition = desiredPosition;
    if (desiredJobTypes) candidate.desiredJobTypes = desiredJobTypes;

    if (dateOfBirth) candidate.dateOfBirth = dateOfBirth;
    if (bio) candidate.bio = bio;
    if (links) candidate.links = links;
    if (gender) candidate.gender = gender;
    if (autoriserProposition !== undefined)
      candidate.autoriserProposition = autoriserProposition;

    if (skills) candidate.skills = skills;
    if (experiences) candidate.experiences = experiences;
    if (education) candidate.education = education;

    await candidate.save();
    res.json({ msg: "Profil mis à jour ✅", candidate });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const uploadProfilePicture = async (req, res) => {
  try {
    const userId = req.user.id;
    const candidate = await Candidate.findOne({ userId });
    if (!candidate) return res.status(404).json({ msg: "Profil introuvable." });

    if (!req.file)
      return res.status(400).json({ msg: "Aucune image fournie." });

    if (candidate.profilePicture) {
      const oldPath = path.join(process.cwd(), candidate.profilePicture);
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }

    const imagePath = req.file.path.replace(/\\/g, "/");

    candidate.profilePicture = imagePath;
    await candidate.save();

    res.json({
      msg: "Photo de profil mise à jour 📸",
      profilePicture: candidate.profilePicture,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const uploadCandidateCV = async (req, res) => {
  try {
    const userId = req.user.id;
    const candidate = await Candidate.findOne({ userId });

    if (!candidate) return res.status(404).json({ msg: "Profil introuvable." });
    if (candidate.cvs.length >= 3)
      return res
        .status(400)
        .json({ msg: "Vous ne pouvez pas ajouter plus de 3 CV." });

    const fileSize = req.file.size;
    let score = 100;
    if (fileSize < 20 * 1024) score = 0;
    else if (fileSize > 5 * 1024 * 1024) score = 50;

    const cvPath = req.file.path.replace(/\\/g, "/");
    candidate.cvs.push({ url: cvPath, score });
    await candidate.save();

    res.json({
      msg: "CV ajouté avec succès ✅",
      cv: { url: cvPath, score },
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const deleteCV = async (req, res) => {
  try {
    const userId = req.user.id;
    const { cvId } = req.params;

    const candidate = await Candidate.findOne({ userId });
    if (!candidate) return res.status(404).json({ msg: "Profil introuvable." });

    const cv = candidate.cvs.id(cvId);
    if (!cv) return res.status(404).json({ msg: "CV introuvable." });

    const filePath = path.join(process.cwd(), cv.url);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    candidate.cvs.pull(cvId);
    await candidate.save();

    res.json({
      msg: "CV supprimé avec succès 🗑️",
      cvs: candidate.cvs,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: err.message });
  }
};

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
        msg: "Veuillez confirmer votre email avant de postuler.",
        code: "EMAIL_NOT_VERIFIED",
      });
    }

    const completion = calculateProfileCompletion(candidate, user);

    if (!completion.canApply) {
      return res.status(400).json({
        msg: `Profil incomplet. Veuillez compléter : ${completion.missingForApplication.join(
          ", "
        )}`,
        missing: completion.missingForApplication,
        code: "PROFILE_INCOMPLETE",
      });
    }

    const cvExists = candidate.cvs.some((cv) => cv.url === cvUrl);
    if (!cvExists) {
      return res.status(400).json({ msg: "CV invalide." });
    }

    const offer = await Offer.findById(offreId).populate("recruteurId");

    if (!offer) {
      return res.status(404).json({ msg: "Offre introuvable." });
    }

    if (!offer.actif || offer.validationStatus !== "approved") {
      return res
        .status(400)
        .json({ msg: "Cette offre n'est plus disponible." });
    }

    if (!offer.visibility?.acceptsDirectApplications) {
      return res.status(403).json({
        msg: "Cette offre n'accepte pas les candidatures directes.",
      });
    }

    const existingApp = await Application.findOne({
      offerId: offreId,
      candidateId: candidate._id,
    });

    if (existingApp) {
      return res
        .status(400)
        .json({ msg: "Vous avez déjà postulé à cette offre." });
    }

    const company = await Company.findById(offer.companyId);

    await Application.create({
      offerId: offreId,
      candidateId: candidate._id,
      cvUrl,
      coverLetter: coverLetter || "",
      status: "en attente",
      offerSnapshot: {
        titre: offer.titre,
        entrepriseNom: company?.name || "Entreprise",
        companyId: offer.companyId,
        location: offer.wilaya,
        salaryMin: offer.salaryMin,
        salaryMax: offer.salaryMax,
        type: offer.type,
      },
    });

    await Offer.findByIdAndUpdate(offreId, { $inc: { nombreCandidatures: 1 } });

    if (offer.recruteurId?.userId) {
      await Notification.create({
        userId: offer.recruteurId.userId,
        message: `Nouvelle candidature pour "${offer.titre}"`,
        type: "info",
      });
    }

    res.json({ msg: "Candidature envoyée avec succès ✅" });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getHistorique = async (req, res) => {
  try {
    const userId = req.user.id;
    const candidate = await Candidate.findOne({ userId });
    if (!candidate) return res.status(404).json({ msg: "Profil introuvable." });

    const applications = await Application.find({ candidateId: candidate._id })
      .sort({ datePostulation: -1 })
      .populate({
        path: "offerId",
        select: "titre actif datePublication wilaya type",
        populate: { path: "companyId", select: "name logo" },
      });

    const enriched = applications.map((app) => ({
      _id: app._id,
      status: app.status,
      date: app.datePostulation,
      cvUrl: app.cvUrl,

      offre: app.offerId
        ? {
            _id: app.offerId._id,
            titre: app.offerId.titre,
            entreprise: app.offerId.companyId?.name || "Inconnue",
            logo: app.offerId.companyId?.logo,
            actif: app.offerId.actif,
          }
        : {
            titre: app.offerSnapshot?.titre,
            entreprise: app.offerSnapshot?.entrepriseNom,
            actif: false,
            deleted: true,
          },
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getProfile = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id }).populate(
      "userId",
      "nom email emailVerified"
    );

    if (!candidate) {
      return res.status(404).json({ msg: "Profil introuvable." });
    }

    const user = await User.findById(req.user.id);
    const completion = calculateProfileCompletion(candidate, user);

    res.json({
      profil: candidate,
      completion,
      emailVerified: user.emailVerified,
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
    if (!user) return res.status(404).json({ msg: "Utilisateur introuvable." });

    if (nom) user.nom = nom;
    if (email) user.email = email;
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

export const addToFavorites = async (req, res) => {
  try {
    const { offerId } = req.params;
    const userId = req.user.id;

    const offerExists = await Offer.exists({ _id: offerId });
    if (!offerExists) {
      return res.status(404).json({ msg: "Offre introuvable." });
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
      { new: true }
    );

    if (!updatedCandidate) {
      return res.status(404).json({ msg: "Profil candidat introuvable." });
    }

    res.json({
      msg: "Offre ajoutée aux favoris ❤️",
      favoris: updatedCandidate.favoris,
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
      { new: true }
    );

    if (!updatedCandidate) {
      return res.status(404).json({ msg: "Profil candidat introuvable." });
    }

    res.json({
      msg: "Offre retirée des favoris 💔",
      favoris: updatedCandidate.favoris,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getFavorites = async (req, res) => {
  try {
    const userId = req.user.id;

    const candidate = await Candidate.findOne({ userId }).populate({
      path: "favoris.offerId",
      select: "titre companyId type wilaya salaryMin salaryMax datePublication",
      populate: {
        path: "companyId",
        select: "name logo location",
      },
    });

    if (!candidate) return res.status(404).json({ msg: "Profil introuvable." });

    const validFavorites = candidate.favoris.filter((f) => f.offerId !== null);

    res.json(validFavorites);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const addSkill = async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, level } = req.body;

    const candidate = await Candidate.findOne({ userId });
    if (!candidate) return res.status(404).json({ msg: "Profil introuvable." });

    candidate.skills.push({ name, level });
    await candidate.save();

    res.json({ msg: "Compétence ajoutée", skills: candidate.skills });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const updateSkill = async (req, res) => {
  try {
    const userId = req.user.id;
    const { skillId } = req.params;
    const { name, level } = req.body;

    const candidate = await Candidate.findOne({ userId });
    if (!candidate) return res.status(404).json({ msg: "Profil introuvable." });

    const skill = candidate.skills.id(skillId);
    if (!skill) return res.status(404).json({ msg: "Compétence introuvable." });

    if (name) skill.name = name;
    if (level) skill.level = level;

    await candidate.save();
    res.json({ msg: "Compétence mise à jour", skills: candidate.skills });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const deleteSkill = async (req, res) => {
  try {
    const userId = req.user.id;
    const { skillId } = req.params;

    const candidate = await Candidate.findOne({ userId });
    if (!candidate) return res.status(404).json({ msg: "Profil introuvable." });

    candidate.skills.pull(skillId);
    await candidate.save();

    res.json({ msg: "Compétence supprimée", skills: candidate.skills });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const addExperience = async (req, res) => {
  try {
    const userId = req.user.id;

    const { jobTitle, company, startDate, endDate, description } = req.body;

    const candidate = await Candidate.findOne({ userId });
    if (!candidate) return res.status(404).json({ msg: "Profil introuvable." });

    candidate.experiences.push({
      jobTitle,
      company,
      startDate,
      endDate,
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
    if (!candidate) return res.status(404).json({ msg: "Profil introuvable." });

    const experience = candidate.experiences.id(experienceId);
    if (!experience)
      return res.status(404).json({ msg: "Expérience introuvable." });

    if (jobTitle) experience.jobTitle = jobTitle;
    if (company) experience.company = company;
    if (startDate) experience.startDate = startDate;

    if (endDate !== undefined) experience.endDate = endDate;
    if (description) experience.description = description;

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
    if (!candidate) return res.status(404).json({ msg: "Profil introuvable." });

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

export const addEducation = async (req, res) => {
  try {
    const userId = req.user.id;

    const { institut, degree, fieldOfStudy, startDate, endDate, description } =
      req.body;

    const candidate = await Candidate.findOne({ userId });
    if (!candidate) return res.status(404).json({ msg: "Profil introuvable." });

    candidate.education.push({
      institut,
      degree,
      fieldOfStudy,
      startDate,
      endDate,
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
    if (!candidate) return res.status(404).json({ msg: "Profil introuvable." });

    const edu = candidate.education.id(educationId);
    if (!edu) return res.status(404).json({ msg: "Formation introuvable." });

    if (institut) edu.institut = institut;
    if (degree) edu.degree = degree;
    if (fieldOfStudy) edu.fieldOfStudy = fieldOfStudy;
    if (startDate) edu.startDate = startDate;
    if (endDate !== undefined) edu.endDate = endDate;
    if (description) edu.description = description;

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
    if (!candidate) return res.status(404).json({ msg: "Profil introuvable." });

    candidate.education.pull(educationId);
    await candidate.save();

    res.json({ msg: "Formation supprimée 🗑️", education: candidate.education });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

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
    ] = await Promise.all([
      Application.countDocuments({ candidateId: candidate._id }),
      Application.aggregate([
        { $match: { candidateId: candidate._id } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
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
        status: {
          $in: ["vu", "présélectionné", "entretien", "accepté", "embauché"],
        },
      }),
    ]);

    const statusMap = {};
    applicationsByStatus.forEach((item) => {
      statusMap[item._id] = item.count;
    });

    const responded =
      (statusMap["accepté"] || 0) +
      (statusMap["rejeté"] || 0) +
      (statusMap["entretien"] || 0) +
      (statusMap["présélectionné"] || 0);

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

    const suggestions = [];
    if (!user.emailVerified) {
      suggestions.push({
        type: "critical",
        message: "Confirmez votre email pour postuler aux offres",
        action: "verify_email",
      });
    }
    if (profileCompletion.percentage < 100) {
      suggestions.push({
        type: "important",
        message: `Complétez votre profil (${profileCompletion.percentage}%)`,
        action: "complete_profile",
        missing: profileCompletion.missing,
      });
    }
    if (candidate.cvs.length === 0) {
      suggestions.push({
        type: "important",
        message: "Ajoutez votre CV pour augmenter vos chances",
        action: "upload_cv",
      });
    }

    res.json({
      applications: {
        total: totalApplications,
        thisMonth: recentApplications,
        thisWeek: weeklyApplications,
        byStatus: statusMap,
      },
      favorites: candidate.favoris.length,
      rates: {
        response: responseRate + "%",
        view: viewRate + "%",
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

    const recentApplications = await Application.find({
      candidateId: candidate._id,
    })
      .sort({ updatedAt: -1 })
      .limit(10)
      .populate({
        path: "offerId",
        select: "titre",
        populate: { path: "companyId", select: "name logo" },
      });

    const activities = recentApplications.map((app) => ({
      type: "application_update",
      date: app.updatedAt,
      title:
        app.offerId?.titre || app.offerSnapshot?.titre || "Offre supprimée",
      company: app.offerId?.companyId?.name || app.offerSnapshot?.entrepriseNom,
      status: app.status,
      applicationId: app._id,
    }));

    res.json(activities);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getRecommendedOffers = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });

    if (!candidate) {
      return res.status(404).json({ msg: "Profil candidat introuvable" });
    }

    const skillNames = (candidate.skills || [])
      .map((s) => s.name?.trim().toLowerCase())
      .filter(Boolean);

    if (skillNames.length === 0) {
      return res.json([]);
    }

    const appliedOfferIds = await Application.find({
      candidateId: candidate._id,
    }).distinct("offerId");

    const offerFilter = {
      actif: true,
      validationStatus: "approved",
      _id: { $nin: appliedOfferIds },
      skills: {
        $in: skillNames.map((s) => new RegExp(`^${s}$`, "i")),
      },
    };

    const candidateWilaya = candidate.residence?.wilaya;

    if (candidateWilaya) {
      offerFilter.wilaya = candidateWilaya;
    }

    const offers = await Offer.find(offerFilter)
      .populate("companyId", "name logo")
      .sort({ nombreCandidatures: -1 })
      .limit(20);

    const scoredOffers = offers.map((offer) => {
      const offerSkills = (offer.skills || []).map((s) =>
        s.trim().toLowerCase()
      );
      const matchingSkills = offerSkills.filter((skill) =>
        skillNames.includes(skill)
      );
      const totalSkills = offerSkills.length || 1;
      const matchScore = Math.round(
        (matchingSkills.length / totalSkills) * 100
      );

      return {
        ...offer.toObject(),
        matchScore,
        matchingSkills,
      };
    });

    scoredOffers.sort((a, b) => {
      if (b.matchScore !== a.matchScore) {
        return b.matchScore - a.matchScore;
      }
      return b.nombreCandidatures - a.nombreCandidatures;
    });

    res.json(scoredOffers.slice(0, 10));
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: err.message });
  }
};
export const confirmInterview = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const candidate = await Candidate.findOne({ userId: req.user.id });

    const application = await Application.findOne({
      _id: applicationId,
      candidateId: candidate._id,
    });

    if (!application)
      return res.status(404).json({ msg: "Candidature introuvable" });

    if (application.status !== "entretien") {
      return res.status(400).json({ msg: "Aucun entretien programmé" });
    }

    application.interviewDetails.confirmedByCandidate = true;
    await application.save();

    res.json({ msg: "Entretien confirmé ✅" });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};
