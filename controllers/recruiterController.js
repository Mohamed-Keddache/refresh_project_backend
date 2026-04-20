import Offer from "../models/Offer.js";
import Recruiter from "../models/Recruiter.js";
import User from "../models/User.js";
import Candidate from "../models/Candidate.js";
import Company from "../models/Company.js";
import Notification from "../models/Notification.js";
import Application from "../models/Application.js";
import Admin from "../models/Admin.js";
import bcrypt from "bcryptjs";
import AnemOffer from "../models/AnemOffer.js";
import { saveFiles } from "../services/fileService.js";
import { createAnemOfferV2 } from "./anemOfferController.js";

const getRecruiterProfile = async (userId) => {
  const recruiter = await Recruiter.findOne({ userId }).populate("companyId");
  if (!recruiter) throw new Error("Profil recruteur non trouvé");
  return recruiter;
};

export const createOffer = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const recruiter = await getRecruiterProfile(req.user.id);

    if (!user.emailVerified) {
      return res.status(403).json({
        msg: "Veuillez confirmer votre email.",
        code: "EMAIL_NOT_VERIFIED",
      });
    }

    if (recruiter.status !== "validated") {
      return res.status(403).json({
        msg: "Votre compte recruteur n'est pas validé.",
        code: "RECRUITER_NOT_VALIDATED",
        recruiterStatus: recruiter.status,
      });
    }

    if (recruiter.companyId.status !== "active") {
      return res.status(403).json({
        msg: "Votre entreprise n'est pas encore validée.",
        code: "COMPANY_NOT_VALIDATED",
      });
    }

    if (!recruiter.permissions.postJobs) {
      return res.status(403).json({
        msg: "Vous n'avez pas la permission de publier des offres.",
        code: "PERMISSION_DENIED",
      });
    }

    const {
      titre,
      description,
      requirements,
      domaine,
      type,
      salaryMin,
      salaryMax,
      experienceLevel,
      skills,
      wilaya,
      visibility,
      candidateSearchMode,
      allowRepostulation,
      hiresNeeded,
      repostulationCooldownDays,
      maxRepostulations,
      enableAnem,
    } = req.body;

    if (!titre || !description || !requirements) {
      return res.status(400).json({
        msg: "Titre, description et requirements sont obligatoires.",
      });
    }

    if (candidateSearchMode === "manual" && !hiresNeeded) {
      return res.status(400).json({
        msg: "Le nombre de recrutements nécessaires (hiresNeeded) est obligatoire si vous demandez à l'admin de proposer des candidats.",
      });
    }

    if (enableAnem && !recruiter.canCreateAnemOffer()) {
      return res.status(403).json({
        msg: "Vous devez être enregistré ANEM pour passer par l'ANEM.",
        code: "ANEM_NOT_REGISTERED",
        anemStatus: recruiter.anem.status,
      });
    }

    const isAnemOffer = !!(enableAnem && recruiter.canCreateAnemOffer());

    const newOffer = new Offer({
      recruteurId: recruiter._id,
      companyId: recruiter.companyId._id,
      titre,
      description,
      requirements,
      domaine,
      type: type || "full-time",
      salaryMin,
      salaryMax,
      allowRepostulation:
        allowRepostulation !== undefined ? allowRepostulation : true,
      hiresNeeded,
      repostulationCooldownDays: repostulationCooldownDays || 30,
      maxRepostulations: maxRepostulations || 2,
      experienceLevel,
      skills: skills || [],
      wilaya,
      visibility: visibility || {
        isPublic: true,
        acceptsDirectApplications: true,
      },
      candidateSearchMode: candidateSearchMode || "disabled",
      validationStatus: isAnemOffer ? "pending_anem" : "pending",
      isAnem: isAnemOffer,
      actif: false,
      datePublication: null,
    });

    const savedOffer = await newOffer.save();

    let anemData = null;
    if (isAnemOffer) {
      try {
        anemData = await createAnemOfferV2(
          savedOffer._id,
          recruiter._id,
          recruiter.companyId._id,
          recruiter.anem.anemId,
          recruiter.anem.registrationId,
        );
      } catch (anemErr) {
        console.error("Error creating ANEM offer V2:", anemErr);
        await Offer.findByIdAndDelete(savedOffer._id);
        return res.status(500).json({
          msg: "Erreur lors de la création de l'offre ANEM",
        });
      }
    }

    const admins = await User.find({ role: "admin" });
    const notifMessage = isAnemOffer
      ? `Nouvelle offre ANEM à traiter : "${savedOffer.titre}" de ${recruiter.companyId.name}`
      : `Nouvelle offre à valider : "${savedOffer.titre}" de ${recruiter.companyId.name}`;

    const notificationPromises = admins.map((admin) =>
      Notification.create({
        userId: admin._id,
        message: notifMessage,
        type: "info",
      }),
    );
    await Promise.all(notificationPromises);

    res.status(201).json({
      msg: isAnemOffer
        ? "Offre ANEM créée et en attente de traitement ✅"
        : "Offre créée et en attente de validation ✅",
      offer: savedOffer,
      anem: anemData
        ? {
            anemOfferId: anemData._id,
            status: anemData.status,
            anemId: anemData.anemId,
          }
        : null,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getMyOffers = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);

    const offers = await Offer.find({
      recruteurId: recruiter._id,
      isDeletedByRecruiter: { $ne: true },
    }).sort({ createdAt: -1 });

    res.json(offers);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getMyOffersWithStats = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);

    const offers = await Offer.aggregate([
      {
        $match: {
          recruteurId: recruiter._id,
          isDeletedByRecruiter: { $ne: true },
        },
      },
      {
        $lookup: {
          from: "applications",
          localField: "_id",
          foreignField: "offerId",
          as: "applications",
        },
      },
      {
        $lookup: {
          from: "anemoffers",
          localField: "_id",
          foreignField: "offerId",
          as: "anemData",
        },
      },
      {
        $addFields: {
          totalApplications: { $size: "$applications" },
          newApplications: {
            $size: {
              $filter: {
                input: "$applications",
                cond: { $eq: ["$$this.seenByRecruiter", false] },
              },
            },
          },
          inDiscussion: {
            $size: {
              $filter: {
                input: "$applications",
                cond: { $eq: ["$$this.recruiterStatus", "en_discussion"] },
              },
            },
          },
          starredCount: {
            $size: {
              $filter: {
                input: "$applications",
                cond: { $eq: ["$$this.isStarred", true] },
              },
            },
          },
          anemPipeline: {
            $cond: {
              if: { $gt: [{ $size: "$anemData" }, 0] },
              then: {
                status: { $arrayElemAt: ["$anemData.status", 0] },
                anemId: { $arrayElemAt: ["$anemData.anemId", 0] },
                cooldownEndsAt: {
                  $arrayElemAt: ["$anemData.cooldownEndsAt", 0],
                },
                failureOption: {
                  $arrayElemAt: ["$anemData.failureOption", 0],
                },
                failureReason: {
                  $arrayElemAt: ["$anemData.failureReason", 0],
                },
              },
              else: null,
            },
          },
        },
      },
      {
        $project: {
          applications: 0,
          anemData: 0,
        },
      },
      { $sort: { createdAt: -1 } },
    ]);

    res.json(offers);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getRecruiterOfferDetails = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);
    const { id } = req.params;

    const offer = await Offer.findById(id);

    if (!offer) {
      return res.status(404).json({ msg: "Offre introuvable" });
    }

    if (offer.recruteurId.toString() !== recruiter._id.toString()) {
      return res
        .status(403)
        .json({ msg: "Action non autorisée. Ce n'est pas votre offre." });
    }

    let anemPipeline = null;
    if (offer.isAnem) {
      const anemOffer = await AnemOffer.findOne({ offerId: offer._id }).lean();
      if (anemOffer) {
        anemPipeline = {
          _id: anemOffer._id,
          status: anemOffer.status,
          anemId: anemOffer.anemId,
          pdfDownloaded: anemOffer.pdfDownloaded,
          cooldownEndsAt: anemOffer.cooldownEndsAt,
          cooldownRemaining:
            anemOffer.status === "in_cooldown" && anemOffer.cooldownEndsAt
              ? Math.max(
                  0,
                  Math.ceil(
                    (new Date(anemOffer.cooldownEndsAt).getTime() -
                      Date.now()) /
                      (1000 * 60 * 60 * 24),
                  ),
                )
              : null,
          failureOption: anemOffer.failureOption,
          failureReason: anemOffer.failureReason,
          failedAt: anemOffer.failedAt,
          publishedAt: anemOffer.publishedAt,
          createdAt: anemOffer.createdAt,
        };
      }
    }

    res.json({
      ...offer.toObject(),
      anemPipeline,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const updateOffer = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);
    const offer = await Offer.findById(req.params.id);

    if (!offer) return res.status(404).json({ msg: "Offre introuvable" });

    if (offer.recruteurId.toString() !== recruiter._id.toString()) {
      return res.status(403).json({ msg: "Action non autorisée" });
    }

    if (offer.isAnem && offer.validationStatus === "pending_anem") {
      return res.status(400).json({
        msg: "Impossible de modifier une offre en cours de traitement ANEM. Vous pouvez la supprimer et en créer une nouvelle.",
        code: "ANEM_PIPELINE_LOCKED",
      });
    }

    const { enableAnem, ...offerData } = req.body;

    if (
      offerData.candidateSearchMode === "manual" &&
      !offerData.hiresNeeded &&
      !offer.hiresNeeded
    ) {
      return res.status(400).json({
        msg: "Le nombre de recrutements nécessaires est obligatoire pour la recherche manuelle.",
      });
    }

    const updatedOffer = await Offer.findByIdAndUpdate(
      req.params.id,
      { $set: offerData },
      { new: true },
    );

    res.json({
      msg: "Offre mise à jour ✅",
      offer: updatedOffer,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const deactivateOffer = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);
    const offer = await Offer.findById(req.params.id);

    if (!offer) return res.status(404).json({ msg: "Offre introuvable" });
    if (offer.recruteurId.toString() !== recruiter._id.toString()) {
      return res.status(403).json({ msg: "Action non autorisée" });
    }

    offer.actif = false;
    await offer.save();

    res.json({ msg: "Offre désactivée ⛔", offer });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const updateRecruiterProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const { nom, motDePasse, ancienMotDePasse, telephone } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ msg: "Utilisateur introuvable" });

    if (nom) user.nom = nom;

    if (motDePasse) {
      if (!ancienMotDePasse) {
        return res.status(400).json({
          msg: "L'ancien mot de passe est requis pour changer de mot de passe.",
        });
      }

      const isMatch = await bcrypt.compare(ancienMotDePasse, user.motDePasse);
      if (!isMatch) {
        return res.status(401).json({ msg: "Ancien mot de passe incorrect." });
      }

      const isSame = await bcrypt.compare(motDePasse, user.motDePasse);
      if (isSame) {
        return res.status(400).json({
          msg: "Le nouveau mot de passe doit être différent de l'ancien.",
        });
      }

      if (motDePasse.length < 8) {
        return res.status(400).json({
          msg: "Le mot de passe doit contenir au moins 8 caractères.",
        });
      }
      if (
        !/[a-z]/.test(motDePasse) ||
        !/[A-Z]/.test(motDePasse) ||
        !/\d/.test(motDePasse)
      ) {
        return res.status(400).json({
          msg: "Le mot de passe doit contenir une minuscule, une majuscule et un chiffre.",
        });
      }

      const hash = await bcrypt.hash(motDePasse, 12);
      user.motDePasse = hash;
    }

    await user.save();

    const recruiter = await Recruiter.findOne({ userId });
    if (!recruiter)
      return res.status(404).json({ msg: "Profil recruteur introuvable" });

    if (telephone) recruiter.telephone = telephone;

    await recruiter.save();

    res.json({
      msg: "Profil mis à jour avec succès ✅",
      user: { nom: user.nom, email: user.email },
      recruiter: {
        telephone: recruiter.telephone,
        position: recruiter.position,
        isAdmin: recruiter.isAdmin,
      },
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

function getStatusMessage(status) {
  const messages = {
    incomplete:
      "Veuillez compléter votre profil recruteur (entreprise, poste, téléphone).",
    pending_validation: "En attente de validation initiale",
    pending_documents: "Documents demandés par l'administration",
    pending_info: "Informations complémentaires demandées",
    pending_info_and_documents:
      "Documents et informations demandés par l'administration",
    pending_revalidation: "Réponse en cours d'examen",
    validated: "Compte validé",
    rejected: "Compte refusé",
  };
  return messages[status] || `Statut: ${status}`;
}

export const updateCompanyDetails = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);

    if (!recruiter.isAdmin) {
      return res.status(403).json({
        msg: "Accès refusé. Seul l'administrateur de l'entreprise peut modifier ces informations.",
      });
    }

    const { website, description, industry, location, size, logo } = req.body;

    const updatedCompany = await Company.findByIdAndUpdate(
      recruiter.companyId._id,
      {
        $set: {
          website,
          description,
          industry,
          location,
          size,
          logo,
        },
      },
      { new: true },
    );

    res.json({
      msg: "Informations de l'entreprise mises à jour ✅",
      company: updatedCompany,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getRecruiterDashboard = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);

    const now = new Date();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const myOfferIds = await Offer.find({
      recruteurId: recruiter._id,
    }).distinct("_id");

    const [
      activeOffers,
      pendingOffers,
      rejectedOffers,
      totalApplications,
      newApplicationsThisWeek,
      applicationsByStatus,
      topOffers,
      recentApplications,
      anemPipelineCounts,
    ] = await Promise.all([
      Offer.countDocuments({
        recruteurId: recruiter._id,
        actif: true,
        validationStatus: "approved",
        isDeletedByRecruiter: { $ne: true },
      }),
      Offer.countDocuments({
        recruteurId: recruiter._id,
        validationStatus: { $in: ["pending", "pending_anem"] },
        isDeletedByRecruiter: { $ne: true },
      }),
      Offer.countDocuments({
        recruteurId: recruiter._id,
        validationStatus: { $in: ["rejected", "changes_requested"] },
        isDeletedByRecruiter: { $ne: true },
      }),
      Application.countDocuments({ offerId: { $in: myOfferIds } }),
      Application.countDocuments({
        offerId: { $in: myOfferIds },
        datePostulation: { $gte: sevenDaysAgo },
      }),
      Application.aggregate([
        { $match: { offerId: { $in: myOfferIds } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Offer.find({
        recruteurId: recruiter._id,
        actif: true,
        isDeletedByRecruiter: { $ne: true },
      })
        .sort({ nombreCandidatures: -1 })
        .limit(5)
        .select("titre nombreCandidatures datePublication"),
      Application.find({ offerId: { $in: myOfferIds } })
        .populate({
          path: "candidateId",
          select: "profilePicture",
          populate: { path: "userId", select: "nom" },
        })
        .populate("offerId", "titre")
        .sort({ datePostulation: -1 })
        .limit(10),
      AnemOffer.aggregate([
        { $match: { recruiterId: recruiter._id } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);

    const statusMap = {};
    applicationsByStatus.forEach((s) => {
      statusMap[s._id] = s.count;
    });

    const anemStatusMap = {};
    anemPipelineCounts.forEach((s) => {
      anemStatusMap[s._id] = s.count;
    });

    const alerts = [];
    if (recruiter.companyId.status !== "active") {
      alerts.push({
        type: "warning",
        message: "Votre entreprise est en attente de validation",
      });
    }
    if (recruiter.status !== "validated") {
      alerts.push({
        type: "warning",
        message: `Statut du compte : ${recruiter.status}`,
        statusMessage: getStatusMessage(recruiter.status),
      });
    }
    if (pendingOffers > 0) {
      alerts.push({
        type: "info",
        message: `${pendingOffers} offre(s) en attente de validation/traitement`,
      });
    }
    if (rejectedOffers > 0) {
      alerts.push({
        type: "error",
        message: `${rejectedOffers} offre(s) nécessitent des modifications`,
      });
    }

    const pendingRequests = recruiter.validationRequests.filter(
      (r) => r.status === "pending",
    );
    if (pendingRequests.length > 0) {
      alerts.push({
        type: "action_required",
        message: "Des documents ou informations sont demandés",
        requests: pendingRequests,
      });
    }

    // Alert for ANEM failures needing action
    if (anemStatusMap["failed"] > 0) {
      alerts.push({
        type: "action_required",
        message: `${anemStatusMap["failed"]} offre(s) ANEM en échec nécessitent votre décision`,
      });
    }

    res.json({
      overview: {
        activeOffers,
        pendingOffers,
        rejectedOffers,
        totalApplications,
        newApplicationsThisWeek,
      },
      applicationsByStatus: statusMap,
      topOffers,
      recentApplications,
      company: {
        name: recruiter.companyId.name,
        status: recruiter.companyId.status,
        logo: recruiter.companyId.logo,
      },
      recruiterStatus: recruiter.status,
      anem: {
        status: recruiter.anem.status,
        anemId: recruiter.anem.anemId,
        isRegistered: recruiter.canCreateAnemOffer(),
        pipeline: anemStatusMap,
      },
      alerts,
      permissions: recruiter.permissions,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getOfferStats = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);
    const { offerId } = req.params;

    const offer = await Offer.findOne({
      _id: offerId,
      recruteurId: recruiter._id,
    });

    if (!offer) {
      return res.status(404).json({ msg: "Offre introuvable" });
    }

    const [applicationsByStatus, applicationsByDay] = await Promise.all([
      Application.aggregate([
        { $match: { offerId: offer._id } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Application.aggregate([
        { $match: { offerId: offer._id } },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$datePostulation" },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        { $limit: 30 },
      ]),
    ]);

    const statusMap = {};
    applicationsByStatus.forEach((s) => {
      statusMap[s._id] = s.count;
    });

    let anemPipeline = null;
    if (offer.isAnem) {
      const anemOffer = await AnemOffer.findOne({ offerId: offer._id }).lean();
      if (anemOffer) {
        anemPipeline = {
          status: anemOffer.status,
          anemId: anemOffer.anemId,
          cooldownEndsAt: anemOffer.cooldownEndsAt,
          failureOption: anemOffer.failureOption,
          publishedAt: anemOffer.publishedAt,
        };
      }
    }

    res.json({
      offer: {
        _id: offer._id,
        titre: offer.titre,
        actif: offer.actif,
        validationStatus: offer.validationStatus,
        isAnem: offer.isAnem,
        datePublication: offer.datePublication,
        nombreCandidatures: offer.nombreCandidatures,
      },
      anemPipeline,
      applicationsByStatus: statusMap,
      applicationsByDay,
      conversionRate:
        offer.nombreCandidatures > 0
          ? Math.round(
              ((statusMap["retenue"] || 0) / offer.nombreCandidatures) * 100,
            )
          : 0,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getRecruiterProfileEndpoint = async (req, res) => {
  try {
    const recruiter = await Recruiter.findOne({ userId: req.user.id })
      .populate("userId", "nom email emailVerified")
      .populate("companyId")
      .populate("anem.registrationId");

    if (!recruiter) {
      return res.status(404).json({ msg: "Profil recruteur introuvable" });
    }

    const alerts = [];
    const user = await User.findById(req.user.id);

    if (!user.emailVerified) {
      alerts.push({
        type: "critical",
        message: "Email non vérifié",
        action: "verify_email",
      });
    }

    if (recruiter.status === "pending_validation") {
      alerts.push({
        type: "warning",
        message: "Compte en attente de validation par un administrateur",
      });
    }

    if (recruiter.status === "rejected") {
      alerts.push({
        type: "error",
        message: "Compte rejeté",
        reason: recruiter.rejectionReason,
      });
    }

    if (recruiter.companyId?.status === "pending") {
      alerts.push({
        type: "warning",
        message: "Entreprise en attente de validation",
      });
    }

    const pendingRequests = recruiter.validationRequests?.filter(
      (r) => r.status === "pending",
    );

    if (pendingRequests?.length > 0) {
      alerts.push({
        type: "action_required",
        message:
          "Des documents ou informations sont demandés par l'administration",
        requests: pendingRequests,
      });
    }

    res.json({
      recruiter,
      alerts,
      canPostOffers:
        user.emailVerified &&
        recruiter.status === "validated" &&
        recruiter.companyId?.status === "active" &&
        recruiter.permissions.postJobs,
      anem: {
        status: recruiter.anem.status,
        anemId: recruiter.anem.anemId,
        isRegistered: recruiter.canCreateAnemOffer(),
        hasSeenModal: recruiter.anem.hasSeenAnemModal,
        declinedAnem: recruiter.anem.declinedAnem,
      },
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getCompanyTeam = async (req, res) => {
  try {
    const recruiter = await Recruiter.findOne({ userId: req.user.id });

    if (!recruiter) {
      return res.status(404).json({ msg: "Profil introuvable" });
    }

    const team = await Recruiter.find({ companyId: recruiter.companyId })
      .populate("userId", "nom email")
      .select("position permissions isAdmin status createdAt");

    res.json(team);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const submitValidationResponse = async (req, res) => {
  try {
    const recruiter = await Recruiter.findOne({ userId: req.user.id });

    if (!recruiter) {
      return res.status(404).json({ msg: "Profil introuvable." });
    }

    const { requestId, text } = req.body;

    const documents = await saveFiles(req.files, "documents");

    const request = recruiter.validationRequests.id(requestId);

    if (!request) {
      return res.status(404).json({ msg: "Demande introuvable." });
    }

    if (request.status !== "pending") {
      return res.status(400).json({ msg: "Cette demande a déjà été traitée." });
    }

    request.response = {
      text,
      documents,
      submittedAt: new Date(),
    };
    request.status = "submitted";

    recruiter.status = "pending_revalidation";

    await recruiter.save();

    const admins = await Admin.find({
      "permissions.validateRecruiters": true,
      status: "active",
    }).populate("userId", "_id");

    const notifPromises = admins.map((admin) =>
      Notification.create({
        userId: admin.userId._id,
        message: `Le recruteur a répondu à une demande de validation.`,
        type: "info",
      }),
    );
    await Promise.all(notifPromises);

    res.json({ msg: "Réponse soumise. Vous serez notifié du résultat." });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getRecruiterById = async (req, res) => {
  try {
    const { id } = req.params;

    const recruiter = await Recruiter.findById(id)
      .populate("userId", "nom email role accountStatus createdAt")
      .populate("companyId", "name logo website location description status");

    if (!recruiter) {
      return res.status(404).json({ msg: "Recruteur introuvable" });
    }

    const isAdmin = req.user && req.user.role === "admin";

    if (!isAdmin) {
      if (recruiter.status !== "validated") {
        return res.status(404).json({ msg: "Ce profil n'est pas accessible." });
      }

      if (recruiter.companyId?.status !== "active") {
        return res
          .status(404)
          .json({ msg: "L'entreprise de ce recruteur n'est pas active." });
      }
    }

    let responseData = {
      _id: recruiter._id,
      nom: recruiter.userId.nom,
      position: recruiter.position,
      entreprise: {
        _id: recruiter.companyId._id,
        nom: recruiter.companyId.name,
        logo: recruiter.companyId.logo,
        location: recruiter.companyId.location,
        website: recruiter.companyId.website,
        description: recruiter.companyId.description,
      },
      dateCreation: recruiter.createdAt,
    };

    if (isAdmin) {
      responseData.adminDetails = {
        email: recruiter.userId.email,
        telephone: recruiter.telephone,
        status: recruiter.status,
        userStatus: recruiter.userId.accountStatus,
        isAdminOfCompany: recruiter.isAdmin,
        permissions: recruiter.permissions,
        validationRequests: recruiter.validationRequests,
        rejectionReason: recruiter.rejectionReason,
        userId: recruiter.userId._id,
        anem: recruiter.anem,
      };
    }

    res.json(responseData);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getCandidateFullProfile = async (req, res) => {
  try {
    const { candidateId } = req.params;

    const candidate = await Candidate.findById(candidateId)
      .populate("userId", "nom email")
      .select("-favoris");

    if (!candidate) {
      return res.status(404).json({ msg: "Candidat introuvable" });
    }

    res.json(candidate);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const completeRecruiterOnboarding = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const recruiter = await Recruiter.findOne({ userId: req.user.id });

    if (!recruiter)
      return res.status(404).json({ msg: "Profil recruteur introuvable." });
    if (recruiter.status !== "incomplete") {
      return res
        .status(400)
        .json({ msg: "Votre compte a déjà passé cette étape." });
    }

    const { position, telephone, companyId, newCompany } = req.body;

    if (!position || !telephone) {
      return res
        .status(400)
        .json({ msg: "Votre poste et numéro de téléphone sont requis." });
    }

    let finalCompanyId;
    let isAdmin = false;

    if (companyId) {
      const comp = await Company.findById(companyId);
      if (!comp)
        return res.status(404).json({ msg: "Entreprise introuvable." });
      finalCompanyId = comp._id;
    } else if (newCompany && newCompany.name) {
      const exist = await Company.findOne({
        name: { $regex: new RegExp(`^${newCompany.name}$`, "i") },
      });
      if (exist)
        return res
          .status(400)
          .json({ msg: "Une entreprise avec ce nom existe déjà." });

      const createdComp = await Company.create({
        name: newCompany.name,
        website: newCompany.website,
        industry: newCompany.industry,
        location: newCompany.location,
        size: newCompany.size,
        status: "pending",
      });
      finalCompanyId = createdComp._id;
      isAdmin = true;
    } else {
      return res
        .status(400)
        .json({ msg: "Vous devez sélectionner ou créer une entreprise." });
    }

    recruiter.companyId = finalCompanyId;
    recruiter.position = position;
    recruiter.telephone = telephone;
    recruiter.isAdmin = isAdmin;
    if (isAdmin) {
      recruiter.permissions.editCompany = true;
      recruiter.permissions.manageTeam = true;
    }

    recruiter.status = "pending_validation";
    await recruiter.save();

    const admins = await Admin.find({
      "permissions.validateRecruiters": true,
    }).populate("userId", "_id");
    const notifPromises = admins.map((admin) =>
      Notification.create({
        userId: admin.userId._id,
        message: `Nouveau recruteur en attente de validation : ${user.nom}`,
        type: "info",
      }),
    );
    await Promise.all(notifPromises);

    res.json({
      msg: "Profil complété avec succès ! En attente de validation par un administrateur.",
      recruiterStatus: recruiter.status,
    });
  } catch (err) {
    console.error("Onboarding error:", err);
    res.status(500).json({ msg: err.message });
  }
};
