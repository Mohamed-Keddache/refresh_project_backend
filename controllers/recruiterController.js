import Offer from "../models/Offer.js";
import Recruiter from "../models/Recruiter.js";
import User from "../models/User.js";
import Candidate from "../models/Candidate.js";
import Company from "../models/Company.js";
import Notification from "../models/Notification.js";
import Application from "../models/Application.js";
import Admin from "../models/Admin.js";
import bcrypt from "bcryptjs";

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
    } = req.body;

    if (!titre || !description || !requirements) {
      return res.status(400).json({
        msg: "Titre, description et requirements sont obligatoires.",
      });
    }

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
      experienceLevel,
      skills: skills || [],
      wilaya,
      visibility: visibility || {
        isPublic: true,
        acceptsDirectApplications: true,
      },
      candidateSearchMode: candidateSearchMode || "disabled",
      validationStatus: "pending",
      actif: false,
      datePublication: null,
    });

    const savedOffer = await newOffer.save();

    const admins = await User.find({ role: "admin" });
    const notificationPromises = admins.map((admin) =>
      Notification.create({
        userId: admin._id,
        message: `Nouvelle offre à valider : "${savedOffer.titre}" de ${recruiter.companyId.name}`,
        type: "info",
      })
    );
    await Promise.all(notificationPromises);

    res.status(201).json({
      msg: "Offre créée et en attente de validation ✅",
      offer: savedOffer,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getMyOffers = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);

    const offers = await Offer.find({ recruteurId: recruiter._id }).sort({
      createdAt: -1,
    });
    res.json(offers);
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

    const updatedOffer = await Offer.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true }
    );

    res.json({ msg: "Offre mise à jour ✅", offer: updatedOffer });
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

export const getOfferApplications = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);
    const { offerId } = req.params;

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const skip = (page - 1) * limit;

    const offerCheck = await Offer.findOne({
      _id: offerId,
      recruteurId: recruiter._id,
    })
      .select("_id")
      .lean();

    if (!offerCheck) {
      return res
        .status(404)
        .json({ msg: "Offre introuvable ou non autorisée" });
    }

    const applications = await Application.find({ offerId: offerId })
      .sort({ datePostulation: -1 })
      .skip(skip)
      .limit(limit)

      .select("-coverLetter")
      .populate({
        path: "candidateId",

        select: "cvs userId profilePicture location",
        populate: {
          path: "userId",
          select: "nom email",
        },
      })
      .lean();

    const validApplications = applications.filter(
      (app) => app.candidateId !== null
    );

    const total = await Application.countDocuments({ offerId: offerId });

    return res.json({
      data: validApplications,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    return res.status(500).json({ msg: err.message });
  }
};

export const updateApplicationStatus = async (req, res) => {
  try {
    const { statut } = req.body;
    const { appId } = req.params;
    const recruiter = await getRecruiterProfile(req.user.id);

    const application = await Application.findById(appId).populate("offerId");

    if (!application)
      return res.status(404).json({ msg: "Candidature introuvable" });

    const offer = await Offer.findById(application.offerId);

    if (offer.recruteurId.toString() !== recruiter._id.toString()) {
      return res.status(403).json({ msg: "Action non autorisée" });
    }

    application.status = statut;
    await application.save();

    await Notification.create({
      userId: application.candidateId,
      message: `Votre candidature pour "${offer.titre}" est passée au statut : ${statut}.`,
      type: "info",
    });

    res.json({ msg: `Statut mis à jour : ${statut}`, application });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const updateRecruiterProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const { nom, motDePasse, telephone } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ msg: "Utilisateur introuvable" });

    if (nom) user.nom = nom;
    if (motDePasse) {
      const hash = await bcrypt.hash(motDePasse, 10);
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
    pending_validation: "En attente de validation initiale",
    pending_documents: "Documents demandés par l'administration",
    pending_info: "Informations complémentaires demandées",
    pending_revalidation: "Réponse en cours d'examen",
    rejected: "Compte refusé",
  };
  return messages[status] || status;
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
      { new: true }
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
    ] = await Promise.all([
      Offer.countDocuments({
        recruteurId: recruiter._id,
        actif: true,
        validationStatus: "approved",
      }),
      Offer.countDocuments({
        recruteurId: recruiter._id,
        validationStatus: "pending",
      }),
      Offer.countDocuments({
        recruteurId: recruiter._id,
        validationStatus: { $in: ["rejected", "changes_requested"] },
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
      Offer.find({ recruteurId: recruiter._id, actif: true })
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
    ]);

    const statusMap = {};
    applicationsByStatus.forEach((s) => {
      statusMap[s._id] = s.count;
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
        message: `${pendingOffers} offre(s) en attente de validation`,
      });
    }
    if (rejectedOffers > 0) {
      alerts.push({
        type: "error",
        message: `${rejectedOffers} offre(s) nécessitent des modifications`,
      });
    }

    const pendingRequests = recruiter.validationRequests.filter(
      (r) => r.status === "pending"
    );
    if (pendingRequests.length > 0) {
      alerts.push({
        type: "action_required",
        message: "Des documents ou informations sont demandés",
        requests: pendingRequests,
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

    res.json({
      offer: {
        _id: offer._id,
        titre: offer.titre,
        actif: offer.actif,
        validationStatus: offer.validationStatus,
        datePublication: offer.datePublication,
        nombreCandidatures: offer.nombreCandidatures,
      },
      applicationsByStatus: statusMap,
      applicationsByDay,
      conversionRate:
        offer.nombreCandidatures > 0
          ? Math.round(
              ((statusMap["accepté"] || 0) / offer.nombreCandidatures) * 100
            )
          : 0,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const scheduleInterview = async (req, res) => {
  try {
    const recruiter = await getRecruiterProfile(req.user.id);
    const { appId } = req.params;
    const { scheduledAt, location, meetingLink, notes } = req.body;

    const application = await Application.findById(appId).populate("offerId");
    if (!application) {
      return res.status(404).json({ msg: "Candidature introuvable." });
    }

    const offer = await Offer.findById(application.offerId);
    if (offer.recruteurId.toString() !== recruiter._id.toString()) {
      return res.status(403).json({ msg: "Non autorisé." });
    }

    if (!recruiter.permissions.scheduleInterviews && !recruiter.isAdmin) {
      return res.status(403).json({
        msg: "Vous n'avez pas la permission de programmer des entretiens.",
      });
    }

    application.status = "entretien";
    application.interviewDetails = {
      scheduledAt: new Date(scheduledAt),
      location,
      meetingLink,
      notes,
      confirmedByCandidate: false,
    };
    await application.save();

    const candidate = await Candidate.findById(application.candidateId);
    await Notification.create({
      userId: candidate.userId,
      message: `Entretien programmé pour "${offer.titre}" le ${new Date(
        scheduledAt
      ).toLocaleDateString("fr-FR")}`,
      type: "validation",
    });

    res.json({ msg: "Entretien programmé avec succès.", application });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getRecruiterProfileEndpoint = async (req, res) => {
  try {
    const recruiter = await Recruiter.findOne({ userId: req.user.id })
      .populate("userId", "nom email emailVerified")
      .populate("companyId");

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
      (r) => r.status === "pending"
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
    const documents = req.files?.map((f) => f.path.replace(/\\/g, "/")) || [];

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
      })
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
