// controllers/candidateAnemController.js
import CandidateAnemRegistration from "../models/CandidateAnemRegistration.js";
import Candidate from "../models/Candidate.js";
import User from "../models/User.js";
import Admin from "../models/Admin.js";
import Notification from "../models/Notification.js";
import { logAdminAction } from "../models/AdminLog.js";

// ============ HELPERS ============

const syncCandidateAnemStatus = async (candidateId, registration) => {
  const updateData = {
    "anem.status": registration.status,
    "anem.lastStatusUpdate": new Date(),
    "anem.registrationId": registration._id,
  };

  if (registration.status === "registered" && registration.verifiedAnemId) {
    updateData["anem.anemId"] = registration.verifiedAnemId;
    updateData["anem.registeredAt"] = registration.verifiedAt || new Date();
  }

  await Candidate.findByIdAndUpdate(candidateId, updateData);
};

const notifyAdminsNewCandidateDemande = async (
  registration,
  candidateName,
  type,
) => {
  const admins = await Admin.find({
    status: "active",
    $or: [{ label: "super_admin" }, { "permissions.validateRecruiters": true }],
  }).populate("userId", "_id");

  const message =
    type === "self_declared"
      ? `Nouvel ID ANEM candidat à vérifier de ${candidateName}`
      : `Nouvelle demande d'inscription ANEM candidat de ${candidateName}`;

  const notifPromises = admins.map((admin) =>
    Notification.create({
      userId: admin.userId._id,
      message,
      type: "info",
    }),
  );

  await Promise.all(notifPromises);
};

// ============ CANDIDATE ENDPOINTS ============

export const getCandidateAnemStatus = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });

    if (!candidate) {
      return res.status(404).json({ msg: "Profil candidat introuvable" });
    }

    let registration = null;
    let latestPublicNote = null;

    if (candidate.anem.registrationId) {
      registration = await CandidateAnemRegistration.findById(
        candidate.anem.registrationId,
      )
        .select("-auditLog")
        .populate("adminNotes.createdBy", "nom")
        .lean();

      if (registration) {
        const publicNotes = registration.adminNotes
          ?.filter((n) => n.isPublic)
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        latestPublicNote = publicNotes?.[0] || null;
      }
    }

    let sidebarView = "not_started";
    let actionRequired = false;
    let statusMessage = "";

    switch (candidate.anem.status) {
      case "not_started":
        sidebarView = "intro";
        statusMessage = "Vous n'êtes pas encore inscrit à l'ANEM";
        break;
      case "draft":
        sidebarView = "continue_form";
        actionRequired = true;
        statusMessage = "Inscription en cours - Continuez votre formulaire";
        break;
      case "pending":
        sidebarView = "pending";
        statusMessage = "Votre demande est en attente de traitement";
        break;
      case "pending_verification":
        sidebarView = "pending_verification";
        statusMessage = "Votre ID ANEM est en cours de vérification";
        break;
      case "in_progress":
        sidebarView = "in_progress";
        statusMessage =
          "Votre inscription est en cours de traitement par notre équipe";
        break;
      case "registered":
        sidebarView = "registered";
        statusMessage = `Vous êtes inscrit à l'ANEM (ID: ${candidate.anem.anemId})`;
        break;
      case "failed":
        sidebarView = "failed";
        actionRequired = true;
        statusMessage = "Votre inscription a échoué - Vous pouvez réessayer";
        break;
      case "rejected":
        sidebarView = "rejected";
        actionRequired = true;
        statusMessage =
          "Votre ID ANEM a été rejeté - Vous pouvez soumettre un nouvel ID";
        break;
    }

    res.json({
      status: candidate.anem.status,
      anemId: candidate.anem.anemId,
      registeredAt: candidate.anem.registeredAt,
      hasSeenAnemInfo: candidate.anem.hasSeenAnemInfo,
      declinedAnem: candidate.anem.declinedAnem,

      sidebarView,
      actionRequired,
      statusMessage,
      latestPublicNote: latestPublicNote
        ? {
            content: latestPublicNote.content,
            createdAt: latestPublicNote.createdAt,
            adminName: latestPublicNote.createdBy?.nom,
          }
        : null,

      registration: registration
        ? {
            _id: registration._id,
            registrationType: registration.registrationType,
            status: registration.status,
            currentStep: registration.currentStep,
            formCompleted: registration.formCompleted,
            formSubmittedAt: registration.formSubmittedAt,
            failureReason: registration.failureReason,
            rejectionReason: registration.rejectionReason,
            declaredAnemId: registration.declaredAnemId,
            verifiedAnemId: registration.verifiedAnemId,
            createdAt: registration.createdAt,
            updatedAt: registration.updatedAt,
            lastRejectedId:
              registration.anemIdHistory?.find((h) => h.status === "rejected")
                ?.anemId || null,
          }
        : null,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const markAnemInfoSeen = async (req, res) => {
  try {
    const candidate = await Candidate.findOneAndUpdate(
      { userId: req.user.id },
      { "anem.hasSeenAnemInfo": true },
      { new: true },
    );

    if (!candidate) {
      return res.status(404).json({ msg: "Profil candidat introuvable" });
    }

    res.json({ msg: "Information ANEM marquée comme vue" });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const declineCandidateAnem = async (req, res) => {
  try {
    const candidate = await Candidate.findOneAndUpdate(
      { userId: req.user.id },
      {
        "anem.hasSeenAnemInfo": true,
        "anem.declinedAnem": true,
        "anem.declinedAt": new Date(),
      },
      { new: true },
    );

    if (!candidate) {
      return res.status(404).json({ msg: "Profil candidat introuvable" });
    }

    res.json({
      msg: "Vous avez choisi de ne pas vous inscrire à l'ANEM pour le moment",
      declinedAnem: true,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const resetCandidateAnemDecline = async (req, res) => {
  try {
    const candidate = await Candidate.findOneAndUpdate(
      { userId: req.user.id },
      {
        "anem.declinedAnem": false,
        "anem.declinedAt": null,
      },
      { new: true },
    );

    if (!candidate) {
      return res.status(404).json({ msg: "Profil candidat introuvable" });
    }

    res.json({
      msg: "Vous pouvez maintenant vous inscrire à l'ANEM",
      declinedAnem: false,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const submitCandidateAnemId = async (req, res) => {
  try {
    const { anemId } = req.body;

    if (!anemId || anemId.trim().length < 3) {
      return res.status(400).json({ msg: "ID ANEM invalide" });
    }

    const candidate = await Candidate.findOne({ userId: req.user.id });
    const user = await User.findById(req.user.id);

    if (!candidate) {
      return res.status(404).json({ msg: "Profil candidat introuvable" });
    }

    if (!user.emailVerified) {
      return res.status(403).json({
        msg: "Veuillez vérifier votre email avant de soumettre un ID ANEM",
        code: "EMAIL_NOT_VERIFIED",
      });
    }

    if (candidate.anem.status === "registered") {
      return res.status(400).json({
        msg: "Vous êtes déjà enregistré ANEM",
        anemId: candidate.anem.anemId,
      });
    }

    let registration = await CandidateAnemRegistration.findOne({
      candidateId: candidate._id,
    });

    const trimmedId = anemId.trim().toUpperCase();

    if (!registration) {
      registration = new CandidateAnemRegistration({
        candidateId: candidate._id,
        userId: req.user.id,
        registrationType: "self_declared",
        declaredAnemId: trimmedId,
        declaredAt: new Date(),
        status: "pending_verification",
        anemIdHistory: [
          {
            anemId: trimmedId,
            submittedAt: new Date(),
            status: "pending",
          },
        ],
      });

      registration.addAuditEntry(
        "created",
        req.user.id,
        { newValue: { registrationType: "self_declared", anemId: trimmedId } },
        req,
      );
    } else {
      const previousId = registration.declaredAnemId;

      const lastHistory =
        registration.anemIdHistory[registration.anemIdHistory.length - 1];
      if (
        !lastHistory ||
        lastHistory.anemId !== trimmedId ||
        lastHistory.status === "rejected"
      ) {
        registration.anemIdHistory.push({
          anemId: trimmedId,
          submittedAt: new Date(),
          status: "pending",
        });
      }

      registration.registrationType = "self_declared";
      registration.declaredAnemId = trimmedId;
      registration.declaredAt = new Date();
      registration.status = "pending_verification";
      registration.rejectionReason = undefined;

      registration.addAuditEntry(
        "anem_id_updated",
        req.user.id,
        { previousValue: previousId, newValue: trimmedId },
        req,
      );
    }

    await registration.save();
    await syncCandidateAnemStatus(candidate._id, registration);

    await Candidate.findByIdAndUpdate(candidate._id, {
      "anem.hasSeenAnemInfo": true,
    });

    await notifyAdminsNewCandidateDemande(
      registration,
      user.nom,
      "self_declared",
    );

    res.status(201).json({
      msg: "ID ANEM soumis pour vérification. Vous serez notifié du résultat.",
      status: "pending_verification",
      registrationId: registration._id,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const startCandidateRegistration = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    const user = await User.findById(req.user.id);

    if (!candidate) {
      return res.status(404).json({ msg: "Profil candidat introuvable" });
    }

    if (!user.emailVerified) {
      return res.status(403).json({
        msg: "Veuillez vérifier votre email avant de vous inscrire à l'ANEM",
        code: "EMAIL_NOT_VERIFIED",
      });
    }

    if (candidate.anem.status === "registered") {
      return res.status(400).json({
        msg: "Vous êtes déjà enregistré ANEM",
        anemId: candidate.anem.anemId,
      });
    }

    let registration = await CandidateAnemRegistration.findOne({
      candidateId: candidate._id,
    });

    // Pre-fill data from existing candidate profile
    const nameParts = user.nom ? user.nom.split(" ") : [];
    const prenom = nameParts[0] || "";
    const nom = nameParts.slice(1).join(" ") || "";

    const prefillStep1 = {
      civilite:
        candidate.gender === "homme"
          ? "monsieur"
          : candidate.gender === "femme"
            ? "madame"
            : undefined,
      nom: nom || undefined,
      prenom: prenom || undefined,
      dateNaissance: candidate.dateOfBirth || undefined,
    };

    const prefillStep2 = {
      mobile: candidate.telephone || undefined,
      wilayaResidence: candidate.residence?.wilaya || undefined,
      communeResidence: candidate.residence?.commune || undefined,
      adresse: candidate.residence?.address || undefined,
    };

    const prefillStep4 = {
      email: user.email,
    };

    if (registration) {
      if (["failed", "rejected"].includes(registration.status)) {
        registration.registrationType = "site_registration";
        registration.status = "draft";
        registration.currentStep = 1;
        registration.formCompleted = false;
        registration.failureReason = undefined;
        registration.rejectionReason = undefined;

        registration.addAuditEntry(
          "created",
          req.user.id,
          { newValue: { action: "restart_after_failure" } },
          req,
        );

        await registration.save();
      } else if (registration.registrationType === "self_declared") {
        registration.registrationType = "site_registration";
        registration.status = "draft";
        registration.currentStep = 1;
        registration.formCompleted = false;

        // Pre-fill if empty
        if (!registration.step1?.nom) {
          registration.step1 = { ...registration.step1, ...prefillStep1 };
        }
        if (!registration.step2?.mobile) {
          registration.step2 = { ...registration.step2, ...prefillStep2 };
        }
        if (!registration.step4?.email) {
          registration.step4 = { ...registration.step4, ...prefillStep4 };
        }

        registration.addAuditEntry(
          "created",
          req.user.id,
          { newValue: { action: "convert_to_site_registration" } },
          req,
        );

        await registration.save();
      }
      // If already draft, just return current state
    } else {
      registration = new CandidateAnemRegistration({
        candidateId: candidate._id,
        userId: req.user.id,
        registrationType: "site_registration",
        status: "draft",
        currentStep: 1,
        step1: prefillStep1,
        step2: prefillStep2,
        step4: prefillStep4,
      });

      registration.addAuditEntry(
        "created",
        req.user.id,
        { newValue: { registrationType: "site_registration" } },
        req,
      );

      await registration.save();
    }

    await syncCandidateAnemStatus(candidate._id, registration);

    await Candidate.findByIdAndUpdate(candidate._id, {
      "anem.hasSeenAnemInfo": true,
    });

    res.json({
      msg: "Inscription démarrée",
      registration: {
        _id: registration._id,
        currentStep: registration.currentStep,
        formCompleted: registration.formCompleted,
        step1: registration.step1 || {},
        step2: registration.step2 || {},
        step3: registration.step3 || {},
        step4: {
          email: registration.step4?.email || user.email,
          consentementRgpd: registration.step4?.consentementRgpd || false,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const saveCandidateRegistrationStep = async (req, res) => {
  try {
    const { step, data } = req.body;

    if (!step || step < 1 || step > 4) {
      return res.status(400).json({ msg: "Étape invalide (1-4)" });
    }

    const candidate = await Candidate.findOne({ userId: req.user.id });
    if (!candidate) {
      return res.status(404).json({ msg: "Profil candidat introuvable" });
    }

    const registration = await CandidateAnemRegistration.findOne({
      candidateId: candidate._id,
      registrationType: "site_registration",
      status: "draft",
    });

    if (!registration) {
      return res.status(404).json({
        msg: "Aucune inscription en cours. Veuillez recommencer.",
        code: "NO_DRAFT_REGISTRATION",
      });
    }

    const stepKey = `step${step}`;
    registration[stepKey] = { ...registration[stepKey], ...data };

    if (
      step === 4 &&
      data.consentementRgpd &&
      !registration.step4?.consentementAt
    ) {
      registration.step4.consentementAt = new Date();
    }

    if (step >= registration.currentStep) {
      registration.currentStep = step;
    }

    registration.addAuditEntry(
      "step_saved",
      req.user.id,
      { newValue: { step } },
      req,
    );

    await registration.save();

    res.json({
      msg: `Étape ${step} enregistrée`,
      currentStep: registration.currentStep,
      savedData: registration[stepKey],
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const submitCandidateRegistration = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    const user = await User.findById(req.user.id);

    if (!candidate) {
      return res.status(404).json({ msg: "Profil candidat introuvable" });
    }

    const registration = await CandidateAnemRegistration.findOne({
      candidateId: candidate._id,
      registrationType: "site_registration",
      status: "draft",
    });

    if (!registration) {
      return res.status(404).json({
        msg: "Aucune inscription en cours trouvée",
        code: "NO_DRAFT_REGISTRATION",
      });
    }

    // Validation
    const validation = {
      step1: { valid: true, missing: [] },
      step2: { valid: true, missing: [] },
      step3: { valid: true, missing: [] },
      step4: { valid: true, missing: [] },
    };

    // Step 1 required fields
    const step1Required = ["nom", "prenom", "dateNaissance", "wilayaNaissance"];
    step1Required.forEach((field) => {
      if (
        !registration.step1?.[field] ||
        registration.step1[field].toString().trim() === ""
      ) {
        validation.step1.valid = false;
        validation.step1.missing.push(field);
      }
    });

    // Step 2 required fields
    const step2Required = ["mobile", "wilayaResidence", "communeResidence"];
    step2Required.forEach((field) => {
      if (
        !registration.step2?.[field] ||
        registration.step2[field].toString().trim() === ""
      ) {
        validation.step2.valid = false;
        validation.step2.missing.push(field);
      }
    });

    // Step 3 required fields
    const step3Required = ["typePieceIdentite", "numeroPieceIdentite"];
    step3Required.forEach((field) => {
      if (
        !registration.step3?.[field] ||
        registration.step3[field].toString().trim() === ""
      ) {
        validation.step3.valid = false;
        validation.step3.missing.push(field);
      }
    });

    // Step 4 required
    if (!registration.step4?.email || registration.step4.email.trim() === "") {
      validation.step4.valid = false;
      validation.step4.missing.push("email");
    }
    if (!registration.step4?.consentementRgpd) {
      validation.step4.valid = false;
      validation.step4.missing.push("consentementRgpd");
    }

    const allValid = Object.values(validation).every((v) => v.valid);

    if (!allValid) {
      return res.status(400).json({
        msg: "Veuillez compléter tous les champs obligatoires",
        validation,
      });
    }

    registration.formCompleted = true;
    registration.formCompletedAt = new Date();
    registration.formSubmittedAt = new Date();
    registration.status = "pending";
    registration.currentStep = 4;

    registration.addAuditEntry(
      "form_submitted",
      req.user.id,
      { newValue: { status: "pending" } },
      req,
    );

    await registration.save();
    await syncCandidateAnemStatus(candidate._id, registration);

    await notifyAdminsNewCandidateDemande(
      registration,
      user.nom,
      "site_registration",
    );

    res.json({
      msg: "Votre demande d'inscription ANEM a été soumise avec succès. Vous serez notifié du résultat.",
      status: "pending",
      registrationId: registration._id,
      submittedAt: registration.formSubmittedAt,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getCandidateRegistrationForm = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    if (!candidate) {
      return res.status(404).json({ msg: "Profil candidat introuvable" });
    }

    const registration = await CandidateAnemRegistration.findOne({
      candidateId: candidate._id,
    })
      .select("-auditLog")
      .populate("adminNotes.createdBy", "nom");

    if (!registration) {
      return res.status(404).json({
        msg: "Aucune inscription trouvée",
        code: "NO_REGISTRATION",
      });
    }

    const user = await User.findById(req.user.id);

    res.json({
      registration: {
        _id: registration._id,
        registrationType: registration.registrationType,
        status: registration.status,
        currentStep: registration.currentStep,
        formCompleted: registration.formCompleted,
        formSubmittedAt: registration.formSubmittedAt,

        step1: registration.step1 || {},
        step2: registration.step2 || {},
        step3: registration.step3 || {},
        step4: {
          email: registration.step4?.email || user.email,
          consentementRgpd: registration.step4?.consentementRgpd || false,
          consentementAt: registration.step4?.consentementAt,
        },

        declaredAnemId: registration.declaredAnemId,
        verifiedAnemId: registration.verifiedAnemId,

        failureReason: registration.failureReason,
        rejectionReason: registration.rejectionReason,

        publicNotes: registration.adminNotes
          ?.filter((n) => n.isPublic)
          .map((n) => ({
            content: n.content,
            createdAt: n.createdAt,
            adminName: n.createdBy?.nom,
          }))
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),

        anemIdHistory: registration.anemIdHistory?.map((h) => ({
          anemId: h.anemId,
          submittedAt: h.submittedAt,
          status: h.status,
          rejectionReason: h.rejectionReason,
        })),
      },
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// ============ ADMIN ENDPOINTS ============

export const getCandidateAnemDemandes = async (req, res) => {
  try {
    const {
      status,
      registrationType,
      wilaya,
      search,
      assignedTo,
      unassigned,
      dateFrom,
      dateTo,
      sortBy = "createdAt",
      sortOrder = "desc",
      page = 1,
      limit = 20,
    } = req.query;

    let query = { status: { $ne: "draft" } };

    if (status) {
      if (status === "new") {
        query.status = { $in: ["pending", "pending_verification"] };
      } else if (status === "active") {
        query.status = {
          $in: ["pending", "pending_verification", "in_progress"],
        };
      } else {
        query.status = status;
      }
    }

    if (registrationType) {
      query.registrationType = registrationType;
    }

    if (wilaya) {
      query["step2.wilayaResidence"] = { $regex: new RegExp(wilaya, "i") };
    }

    if (assignedTo) {
      query.assignedTo = assignedTo;
    }
    if (unassigned === "true") {
      query.assignedTo = { $exists: false };
    }

    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) {
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        query.createdAt.$lte = endDate;
      }
    }

    if (search) {
      const searchRegex = { $regex: search, $options: "i" };
      const matchingUsers = await User.find({
        $or: [{ nom: searchRegex }, { email: searchRegex }],
      }).select("_id");
      const userIds = matchingUsers.map((u) => u._id);

      query.$or = [
        { userId: { $in: userIds } },
        { "step1.nom": searchRegex },
        { "step1.prenom": searchRegex },
        { declaredAnemId: searchRegex },
        { verifiedAnemId: searchRegex },
      ];
    }

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

    const [demandes, total, statusCounts] = await Promise.all([
      CandidateAnemRegistration.find(query)
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .populate("userId", "nom email")
        .populate("candidateId", "telephone residence profilePicture")
        .populate("assignedTo", "userId label")
        .lean(),
      CandidateAnemRegistration.countDocuments(query),
      CandidateAnemRegistration.aggregate([
        { $match: { status: { $ne: "draft" } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);

    const enrichedDemandes = await Promise.all(
      demandes.map(async (d) => {
        let assignedAdminName = null;
        if (d.assignedTo?.userId) {
          const adminUser = await User.findById(d.assignedTo.userId).select(
            "nom",
          );
          assignedAdminName = adminUser?.nom;
        }

        return {
          _id: d._id,
          registrationType: d.registrationType,
          status: d.status,
          currentStep: d.currentStep,
          formCompleted: d.formCompleted,
          formSubmittedAt: d.formSubmittedAt,
          declaredAnemId: d.declaredAnemId,
          verifiedAnemId: d.verifiedAnemId,

          candidate: {
            _id: d.candidateId?._id,
            nom: d.userId?.nom,
            email: d.userId?.email,
            telephone: d.candidateId?.telephone,
            profilePicture: d.candidateId?.profilePicture,
          },

          wilaya: d.step2?.wilayaResidence,
          nomComplet: `${d.step1?.prenom || ""} ${d.step1?.nom || ""}`.trim(),

          assignedTo: d.assignedTo
            ? {
                _id: d.assignedTo._id,
                name: assignedAdminName,
                label: d.assignedTo.label,
              }
            : null,
          assignedAt: d.assignedAt,

          pdfDownloadCount: d.pdfDownloads?.length || 0,
          lastPdfDownload: d.pdfDownloads?.slice(-1)[0]?.downloadedAt,

          failureReason: d.failureReason,
          rejectionReason: d.rejectionReason,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        };
      }),
    );

    const countsMap = {};
    statusCounts.forEach((s) => {
      countsMap[s._id] = s.count;
    });

    res.json({
      data: enrichedDemandes,
      meta: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit),
      },
      statusCounts: countsMap,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getCandidateDemandeDetails = async (req, res) => {
  try {
    const { demandeId } = req.params;

    const demande = await CandidateAnemRegistration.findById(demandeId)
      .populate("userId", "nom email createdAt")
      .populate(
        "candidateId",
        "telephone residence profilePicture gender dateOfBirth bio skills experiences education",
      )
      .populate("assignedTo", "userId label")
      .populate("verifiedBy", "nom")
      .populate("assignedBy", "nom")
      .populate("adminNotes.createdBy", "nom")
      .populate("auditLog.performedBy", "nom")
      .populate("anemIdHistory.reviewedBy", "nom")
      .populate("pdfDownloads.downloadedBy", "nom");

    if (!demande) {
      return res.status(404).json({ msg: "Demande introuvable" });
    }

    let assignedAdminName = null;
    if (demande.assignedTo?.userId) {
      const adminUser = await User.findById(demande.assignedTo.userId).select(
        "nom",
      );
      assignedAdminName = adminUser?.nom;
    }

    await logAdminAction(
      req.user.id,
      "candidate_anem_demande_viewed",
      { type: "candidate_anem_registration", id: demande._id },
      {},
      req,
    );

    res.json({
      ...demande.toObject(),
      assignedAdminName,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getCandidatePendingAnemIds = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      sortBy = "declaredAt",
      sortOrder = "desc",
    } = req.query;
    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

    const [demandes, total] = await Promise.all([
      CandidateAnemRegistration.find({
        registrationType: "self_declared",
        status: "pending_verification",
      })
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .populate("userId", "nom email")
        .populate("candidateId", "telephone profilePicture")
        .lean(),
      CandidateAnemRegistration.countDocuments({
        registrationType: "self_declared",
        status: "pending_verification",
      }),
    ]);

    const enriched = demandes.map((d) => ({
      _id: d._id,
      declaredAnemId: d.declaredAnemId,
      declaredAt: d.declaredAt,
      candidate: {
        _id: d.candidateId?._id,
        nom: d.userId?.nom,
        email: d.userId?.email,
        profilePicture: d.candidateId?.profilePicture,
      },
      previousSubmissions: d.anemIdHistory
        ?.filter((h) => h.status === "rejected")
        .map((h) => ({
          anemId: h.anemId,
          submittedAt: h.submittedAt,
          rejectionReason: h.rejectionReason,
        })),
      createdAt: d.createdAt,
    }));

    res.json({
      data: enriched,
      meta: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const assignCandidateDemande = async (req, res) => {
  try {
    const { demandeId } = req.params;
    const { adminId } = req.body;

    const demande = await CandidateAnemRegistration.findById(demandeId);
    if (!demande) {
      return res.status(404).json({ msg: "Demande introuvable" });
    }

    let targetAdminId = adminId;

    if (!adminId) {
      const selfAdmin = await Admin.findOne({ userId: req.user.id });
      if (!selfAdmin) {
        return res.status(400).json({ msg: "Admin ID requis" });
      }
      targetAdminId = selfAdmin._id;
    }

    const targetAdmin = await Admin.findById(targetAdminId).populate(
      "userId",
      "nom",
    );
    if (!targetAdmin) {
      return res.status(404).json({ msg: "Admin cible introuvable" });
    }

    const previousAssigned = demande.assignedTo;

    demande.assignedTo = targetAdminId;
    demande.assignedAt = new Date();
    demande.assignedBy = req.user.id;

    demande.addAuditEntry(
      "assigned",
      req.user.id,
      { previousValue: previousAssigned, newValue: targetAdminId },
      req,
    );

    await demande.save();

    await logAdminAction(
      req.user.id,
      "candidate_anem_demande_assigned",
      { type: "candidate_anem_registration", id: demande._id },
      { assignedTo: targetAdminId, adminName: targetAdmin.userId.nom },
      req,
    );

    res.json({
      msg: `Demande assignée à ${targetAdmin.userId.nom}`,
      assignedTo: {
        _id: targetAdmin._id,
        name: targetAdmin.userId.nom,
        label: targetAdmin.label,
      },
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const markCandidateDemandeInProgress = async (req, res) => {
  try {
    const { demandeId } = req.params;

    const demande = await CandidateAnemRegistration.findById(demandeId);
    if (!demande) {
      return res.status(404).json({ msg: "Demande introuvable" });
    }

    if (!["pending", "pending_verification"].includes(demande.status)) {
      return res.status(400).json({
        msg: "Seules les demandes en attente peuvent être marquées en cours",
        currentStatus: demande.status,
      });
    }

    const previousStatus = demande.status;
    demande.status = "in_progress";

    if (!demande.assignedTo) {
      const selfAdmin = await Admin.findOne({ userId: req.user.id });
      if (selfAdmin) {
        demande.assignedTo = selfAdmin._id;
        demande.assignedAt = new Date();
        demande.assignedBy = req.user.id;
      }
    }

    demande.addAuditEntry(
      "status_changed",
      req.user.id,
      { previousValue: previousStatus, newValue: "in_progress" },
      req,
    );

    await demande.save();
    await syncCandidateAnemStatus(demande.candidateId, demande);

    await Notification.create({
      userId: demande.userId,
      message:
        "Votre demande d'inscription ANEM est en cours de traitement par notre équipe.",
      type: "info",
    });

    await logAdminAction(
      req.user.id,
      "candidate_anem_demande_in_progress",
      { type: "candidate_anem_registration", id: demande._id },
      { previousStatus },
      req,
    );

    res.json({
      msg: "Demande marquée en cours de traitement",
      status: "in_progress",
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getCandidateAnemPdfData = async (req, res) => {
  try {
    const { demandeId } = req.params;

    const demande = await CandidateAnemRegistration.findById(demandeId);
    if (!demande) {
      return res.status(404).json({ msg: "Demande introuvable" });
    }

    demande.pdfDownloads.push({
      downloadedBy: req.user.id,
      downloadedAt: new Date(),
      ip: req.ip || req.connection?.remoteAddress,
    });

    demande.addAuditEntry("pdf_downloaded", req.user.id, {}, req);
    await demande.save();

    const pdfData = await demande.generatePdfData();

    await logAdminAction(
      req.user.id,
      "candidate_anem_pdf_downloaded",
      { type: "candidate_anem_registration", id: demande._id },
      {},
      req,
    );

    res.json(pdfData);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const approveCandidateAnemId = async (req, res) => {
  try {
    const { demandeId } = req.params;
    const { comment } = req.body;

    const demande = await CandidateAnemRegistration.findById(demandeId);
    if (!demande) {
      return res.status(404).json({ msg: "Demande introuvable" });
    }

    if (demande.status !== "pending_verification") {
      return res.status(400).json({
        msg: "Seuls les IDs en attente de vérification peuvent être approuvés",
        currentStatus: demande.status,
      });
    }

    const previousStatus = demande.status;
    demande.status = "registered";
    demande.verifiedAnemId = demande.declaredAnemId;
    demande.verifiedAt = new Date();
    demande.verifiedBy = req.user.id;

    const lastHistory = demande.anemIdHistory[demande.anemIdHistory.length - 1];
    if (lastHistory && lastHistory.status === "pending") {
      lastHistory.status = "approved";
      lastHistory.reviewedBy = req.user.id;
      lastHistory.reviewedAt = new Date();
      lastHistory.adminComment = comment;
    }

    if (comment) {
      demande.adminNotes.push({
        content: comment,
        createdBy: req.user.id,
        isPublic: true,
      });
    }

    demande.addAuditEntry(
      "status_changed",
      req.user.id,
      { previousValue: previousStatus, newValue: "registered" },
      req,
    );

    await demande.save();
    await syncCandidateAnemStatus(demande.candidateId, demande);

    await Notification.create({
      userId: demande.userId,
      message: `Félicitations ! Votre ID ANEM (${demande.verifiedAnemId}) a été vérifié avec succès. Vous êtes maintenant inscrit à l'ANEM.`,
      type: "validation",
    });

    await logAdminAction(
      req.user.id,
      "candidate_anem_id_approved",
      { type: "candidate_anem_registration", id: demande._id },
      { anemId: demande.verifiedAnemId },
      req,
    );

    res.json({
      msg: "ID ANEM approuvé avec succès",
      status: "registered",
      anemId: demande.verifiedAnemId,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const rejectCandidateAnemId = async (req, res) => {
  try {
    const { demandeId } = req.params;
    const { reason, publicMessage } = req.body;

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ msg: "Raison de rejet requise" });
    }

    const demande = await CandidateAnemRegistration.findById(demandeId);
    if (!demande) {
      return res.status(404).json({ msg: "Demande introuvable" });
    }

    if (demande.status !== "pending_verification") {
      return res.status(400).json({
        msg: "Seuls les IDs en attente de vérification peuvent être rejetés",
        currentStatus: demande.status,
      });
    }

    const previousStatus = demande.status;
    demande.status = "rejected";
    demande.rejectionReason = reason;

    const lastHistory = demande.anemIdHistory[demande.anemIdHistory.length - 1];
    if (lastHistory && lastHistory.status === "pending") {
      lastHistory.status = "rejected";
      lastHistory.reviewedBy = req.user.id;
      lastHistory.reviewedAt = new Date();
      lastHistory.rejectionReason = reason;
    }

    demande.adminNotes.push({
      content: publicMessage || `ID ANEM rejeté: ${reason}`,
      createdBy: req.user.id,
      isPublic: true,
    });

    demande.addAuditEntry(
      "status_changed",
      req.user.id,
      { previousValue: previousStatus, newValue: "rejected" },
      req,
    );

    await demande.save();
    await syncCandidateAnemStatus(demande.candidateId, demande);

    await Notification.create({
      userId: demande.userId,
      message: `Votre ID ANEM n'a pas pu être vérifié. Raison: ${reason}. Vous pouvez soumettre un nouvel ID ou vous inscrire via notre formulaire.`,
      type: "alerte",
    });

    await logAdminAction(
      req.user.id,
      "candidate_anem_id_rejected",
      { type: "candidate_anem_registration", id: demande._id },
      { reason, rejectedId: demande.declaredAnemId },
      req,
    );

    res.json({
      msg: "ID ANEM rejeté",
      status: "rejected",
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const markCandidateRegistered = async (req, res) => {
  try {
    const { demandeId } = req.params;
    const { anemId, message } = req.body;

    if (!anemId || anemId.trim().length < 3) {
      return res.status(400).json({ msg: "ID ANEM valide requis" });
    }

    const demande = await CandidateAnemRegistration.findById(demandeId);
    if (!demande) {
      return res.status(404).json({ msg: "Demande introuvable" });
    }

    if (!["pending", "in_progress"].includes(demande.status)) {
      return res.status(400).json({
        msg: "Seules les demandes en attente ou en cours peuvent être marquées comme enregistrées",
        currentStatus: demande.status,
      });
    }

    const previousStatus = demande.status;
    const trimmedId = anemId.trim().toUpperCase();

    demande.status = "registered";
    demande.verifiedAnemId = trimmedId;
    demande.verifiedAt = new Date();
    demande.verifiedBy = req.user.id;

    const publicMsg =
      message || `Inscription ANEM réussie. Votre ID ANEM: ${trimmedId}`;
    demande.adminNotes.push({
      content: publicMsg,
      createdBy: req.user.id,
      isPublic: true,
    });

    demande.addAuditEntry(
      "status_changed",
      req.user.id,
      {
        previousValue: previousStatus,
        newValue: "registered",
        anemId: trimmedId,
      },
      req,
    );

    await demande.save();
    await syncCandidateAnemStatus(demande.candidateId, demande);

    await Notification.create({
      userId: demande.userId,
      message: `Félicitations ! Vous êtes maintenant enregistré auprès de l'ANEM. Votre ID ANEM: ${trimmedId}`,
      type: "validation",
    });

    await logAdminAction(
      req.user.id,
      "candidate_anem_registration_success",
      { type: "candidate_anem_registration", id: demande._id },
      { anemId: trimmedId },
      req,
    );

    res.json({
      msg: "Inscription ANEM enregistrée avec succès",
      status: "registered",
      anemId: trimmedId,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const markCandidateAnemFailed = async (req, res) => {
  try {
    const { demandeId } = req.params;
    const { reason, publicMessage } = req.body;

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ msg: "Raison de l'échec requise" });
    }

    const demande = await CandidateAnemRegistration.findById(demandeId);
    if (!demande) {
      return res.status(404).json({ msg: "Demande introuvable" });
    }

    if (!["pending", "in_progress"].includes(demande.status)) {
      return res.status(400).json({
        msg: "Seules les demandes en attente ou en cours peuvent être marquées comme échouées",
        currentStatus: demande.status,
      });
    }

    const previousStatus = demande.status;
    demande.status = "failed";
    demande.failureReason = reason;

    demande.adminNotes.push({
      content: publicMessage || `Inscription échouée: ${reason}`,
      createdBy: req.user.id,
      isPublic: true,
    });

    demande.addAuditEntry(
      "status_changed",
      req.user.id,
      { previousValue: previousStatus, newValue: "failed" },
      req,
    );

    await demande.save();
    await syncCandidateAnemStatus(demande.candidateId, demande);

    await Notification.create({
      userId: demande.userId,
      message: `Nous n'avons pas pu finaliser votre inscription ANEM. Raison: ${reason}. Vous pouvez réessayer en soumettant une nouvelle demande.`,
      type: "alerte",
    });

    await logAdminAction(
      req.user.id,
      "candidate_anem_registration_failed",
      { type: "candidate_anem_registration", id: demande._id },
      { reason },
      req,
    );

    res.json({
      msg: "Inscription marquée comme échouée",
      status: "failed",
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const addCandidateAnemAdminNote = async (req, res) => {
  try {
    const { demandeId } = req.params;
    const { note, isPublic = false } = req.body;

    if (!note || note.trim().length === 0) {
      return res.status(400).json({ msg: "Note requise" });
    }

    const demande = await CandidateAnemRegistration.findById(demandeId);
    if (!demande) {
      return res.status(404).json({ msg: "Demande introuvable" });
    }

    demande.adminNotes.push({
      content: note.trim(),
      createdBy: req.user.id,
      isPublic: isPublic,
    });

    demande.addAuditEntry(
      "note_added",
      req.user.id,
      { newValue: { note, isPublic } },
      req,
    );

    await demande.save();

    if (isPublic) {
      await Notification.create({
        userId: demande.userId,
        message: `Mise à jour concernant votre demande ANEM: ${note.substring(0, 100)}${note.length > 100 ? "..." : ""}`,
        type: "info",
      });
    }

    await logAdminAction(
      req.user.id,
      "candidate_anem_note_added",
      { type: "candidate_anem_registration", id: demande._id },
      { isPublic },
      req,
    );

    const user = await User.findById(req.user.id).select("nom");

    res.json({
      msg: "Note ajoutée",
      note: {
        content: note.trim(),
        createdAt: new Date(),
        createdBy: { nom: user.nom },
        isPublic,
      },
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getCandidateAnemStats = async (req, res) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const [
      statusCounts,
      newDemandesThisWeek,
      newDemandesThisMonth,
      pendingOlderThan7Days,
      registrationsByType,
      processingTimes,
    ] = await Promise.all([
      CandidateAnemRegistration.aggregate([
        { $match: { status: { $ne: "draft" } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      CandidateAnemRegistration.countDocuments({
        status: { $ne: "draft" },
        createdAt: { $gte: sevenDaysAgo },
      }),
      CandidateAnemRegistration.countDocuments({
        status: { $ne: "draft" },
        createdAt: { $gte: thirtyDaysAgo },
      }),
      CandidateAnemRegistration.countDocuments({
        status: { $in: ["pending", "pending_verification"] },
        createdAt: { $lt: sevenDaysAgo },
      }),
      CandidateAnemRegistration.aggregate([
        { $match: { status: { $ne: "draft" } } },
        { $group: { _id: "$registrationType", count: { $sum: 1 } } },
      ]),
      CandidateAnemRegistration.aggregate([
        {
          $match: {
            status: "registered",
            verifiedAt: { $exists: true },
            formSubmittedAt: { $exists: true },
          },
        },
        {
          $project: {
            processingDays: {
              $divide: [
                { $subtract: ["$verifiedAt", "$formSubmittedAt"] },
                1000 * 60 * 60 * 24,
              ],
            },
          },
        },
        {
          $group: {
            _id: null,
            avgDays: { $avg: "$processingDays" },
            minDays: { $min: "$processingDays" },
            maxDays: { $max: "$processingDays" },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const countsMap = {};
    statusCounts.forEach((s) => {
      countsMap[s._id] = s.count;
    });

    const typeMap = {};
    registrationsByType.forEach((t) => {
      typeMap[t._id] = t.count;
    });

    const totalDemandes = Object.values(countsMap).reduce((a, b) => a + b, 0);
    const successfulRegistrations = countsMap["registered"] || 0;
    const successRate =
      totalDemandes > 0
        ? Math.round((successfulRegistrations / totalDemandes) * 100)
        : 0;

    res.json({
      overview: {
        total: totalDemandes,
        pending:
          (countsMap["pending"] || 0) +
          (countsMap["pending_verification"] || 0),
        inProgress: countsMap["in_progress"] || 0,
        registered: countsMap["registered"] || 0,
        failed: countsMap["failed"] || 0,
        rejected: countsMap["rejected"] || 0,
      },
      trends: {
        newThisWeek: newDemandesThisWeek,
        newThisMonth: newDemandesThisMonth,
        pendingOlderThan7Days,
      },
      byType: {
        siteRegistration: typeMap["site_registration"] || 0,
        selfDeclared: typeMap["self_declared"] || 0,
      },
      performance: {
        successRate: `${successRate}%`,
        avgProcessingDays: processingTimes[0]?.avgDays?.toFixed(1) || "N/A",
        minProcessingDays: processingTimes[0]?.minDays?.toFixed(1) || "N/A",
        maxProcessingDays: processingTimes[0]?.maxDays?.toFixed(1) || "N/A",
        totalCompleted: processingTimes[0]?.count || 0,
      },
      statusCounts: countsMap,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getCandidateAnemNewCount = async (req, res) => {
  try {
    const [pendingCount, unassignedCount] = await Promise.all([
      CandidateAnemRegistration.countDocuments({
        status: { $in: ["pending", "pending_verification"] },
      }),
      CandidateAnemRegistration.countDocuments({
        status: { $in: ["pending", "pending_verification"] },
        assignedTo: { $exists: false },
      }),
    ]);

    res.json({
      total: pendingCount,
      unassigned: unassignedCount,
      hasNew: pendingCount > 0,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};
