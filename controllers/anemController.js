// === controllers/anemController.js ===
import AnemRegistration from "../models/AnemRegistration.js";
import AnemOffer from "../models/AnemOffer.js";
import Recruiter from "../models/Recruiter.js";
import Offer from "../models/Offer.js";
import User from "../models/User.js";
import Admin from "../models/Admin.js";
import Notification from "../models/Notification.js";
import AdminLog, { logAdminAction } from "../models/AdminLog.js";

// ============================================
// HELPER FUNCTIONS
// ============================================

const getRecruiterWithAnem = async (userId) => {
  const recruiter = await Recruiter.findOne({ userId })
    .populate("companyId")
    .populate("anem.registrationId");

  if (!recruiter) {
    throw new Error("Profil recruteur introuvable");
  }

  return recruiter;
};

const syncRecruiterAnemStatus = async (recruiterId, registration) => {
  const updateData = {
    "anem.status": registration.status,
    "anem.lastStatusUpdate": new Date(),
    "anem.registrationId": registration._id,
  };

  if (registration.status === "registered" && registration.verifiedAnemId) {
    updateData["anem.anemId"] = registration.verifiedAnemId;
    updateData["anem.registeredAt"] = registration.verifiedAt || new Date();
  }

  await Recruiter.findByIdAndUpdate(recruiterId, updateData);
};

const notifyAdminsNewDemande = async (registration, recruiterName, type) => {
  const admins = await Admin.find({
    status: "active",
    $or: [{ label: "super_admin" }, { "permissions.validateRecruiters": true }],
  }).populate("userId", "_id");

  const message =
    type === "self_declared"
      ? `Nouvel ID ANEM à vérifier de ${recruiterName}`
      : `Nouvelle demande d'inscription ANEM de ${recruiterName}`;

  const notifPromises = admins.map((admin) =>
    Notification.create({
      userId: admin.userId._id,
      message,
      type: "info",
    }),
  );

  await Promise.all(notifPromises);
};

// ============================================
// RECRUITER ENDPOINTS
// ============================================

/**
 * Get complete ANEM status and info for the logged-in recruiter
 * Used for the ANEM sidebar section
 */
export const getAnemStatus = async (req, res) => {
  try {
    const recruiter = await getRecruiterWithAnem(req.user.id);

    const offerCount = await Offer.countDocuments({
      recruteurId: recruiter._id,
    });

    // Get ANEM offer stats
    const [anemOfferCount, totalActiveOffers] = await Promise.all([
      AnemOffer.countDocuments({
        recruiterId: recruiter._id,
        anemEnabled: true,
      }),
      Offer.countDocuments({
        recruteurId: recruiter._id,
        actif: true,
        validationStatus: "approved",
      }),
    ]);

    let registration = null;
    let latestPublicNote = null;

    if (recruiter.anem.registrationId) {
      registration = await AnemRegistration.findById(
        recruiter.anem.registrationId,
      )
        .select("-auditLog")
        .populate("adminNotes.createdBy", "nom")
        .lean();

      if (registration) {
        // Get latest public note for status display
        const publicNotes = registration.adminNotes
          ?.filter((n) => n.isPublic)
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        latestPublicNote = publicNotes?.[0] || null;
      }
    }

    // Determine what to show in sidebar based on status
    let sidebarView = "not_started";
    let actionRequired = false;
    let statusMessage = "";

    switch (recruiter.anem.status) {
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
        statusMessage = `Vous êtes inscrit à l'ANEM (ID: ${recruiter.anem.anemId})`;
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
      // Basic status
      status: recruiter.anem.status,
      anemId: recruiter.anem.anemId,
      registeredAt: recruiter.anem.registeredAt,

      // Modal tracking
      hasSeenAnemModal: recruiter.anem.hasSeenAnemModal,
      declinedAnem: recruiter.anem.declinedAnem,

      // Offer context
      isFirstOffer: offerCount === 0,
      canCreateAnemOffer: recruiter.canCreateAnemOffer(),

      // Sidebar display info
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

      // Registration details (if exists)
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
            // Last ANEM ID submission if rejected (for resubmission)
            lastRejectedId:
              registration.anemIdHistory?.find((h) => h.status === "rejected")
                ?.anemId || null,
          }
        : null,

      // Stats
      stats: {
        totalOffers: offerCount,
        activeOffers: totalActiveOffers,
        anemOffers: anemOfferCount,
        offersWithoutAnem: totalActiveOffers - anemOfferCount,
      },
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Check if ANEM modal should be shown before offer creation
 */
export const checkAnemModalRequired = async (req, res) => {
  try {
    const recruiter = await Recruiter.findOne({ userId: req.user.id });

    if (!recruiter) {
      return res.status(404).json({ msg: "Profil recruteur introuvable" });
    }

    const offerCount = await Offer.countDocuments({
      recruteurId: recruiter._id,
    });

    const isFirstOffer = offerCount === 0;
    const hasSeenModal = recruiter.anem.hasSeenAnemModal;
    const declinedAnem = recruiter.anem.declinedAnem;
    const isRegistered = recruiter.canCreateAnemOffer();

    // Determine if modal should show
    let showModal = false;
    let modalReason = null;

    if (isFirstOffer && !hasSeenModal) {
      showModal = true;
      modalReason = "first_offer";
    }

    res.json({
      showModal,
      modalReason,
      isFirstOffer,
      hasSeenModal,
      declinedAnem,
      isRegistered,
      anemStatus: recruiter.anem.status,
      anemId: recruiter.anem.anemId,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Mark that recruiter has seen the ANEM modal
 */
export const markAnemModalSeen = async (req, res) => {
  try {
    const recruiter = await Recruiter.findOneAndUpdate(
      { userId: req.user.id },
      {
        "anem.hasSeenAnemModal": true,
        "anem.modalSeenAt": new Date(),
      },
      { new: true },
    );

    if (!recruiter) {
      return res.status(404).json({ msg: "Profil recruteur introuvable" });
    }

    res.json({
      msg: "Modal marqué comme vu",
      hasSeenAnemModal: true,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Decline ANEM registration (user chose "No" to first question)
 */
export const declineAnem = async (req, res) => {
  try {
    const recruiter = await Recruiter.findOneAndUpdate(
      { userId: req.user.id },
      {
        "anem.hasSeenAnemModal": true,
        "anem.modalSeenAt": new Date(),
        "anem.declinedAnem": true,
        "anem.declinedAt": new Date(),
      },
      { new: true },
    );

    if (!recruiter) {
      return res.status(404).json({ msg: "Profil recruteur introuvable" });
    }

    res.json({
      msg: "Vous avez choisi de ne pas utiliser ANEM pour le moment",
      declinedAnem: true,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Reset ANEM decline (user wants to reconsider)
 */
export const resetAnemDecline = async (req, res) => {
  try {
    const recruiter = await Recruiter.findOneAndUpdate(
      { userId: req.user.id },
      {
        "anem.declinedAnem": false,
        "anem.declinedAt": null,
      },
      { new: true },
    );

    if (!recruiter) {
      return res.status(404).json({ msg: "Profil recruteur introuvable" });
    }

    res.json({
      msg: "Vous pouvez maintenant vous inscrire à l'ANEM",
      declinedAnem: false,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Submit a self-declared ANEM ID for verification
 * (User claims to already have an ANEM ID)
 */
export const submitAnemId = async (req, res) => {
  try {
    const { anemId } = req.body;

    if (!anemId || anemId.trim().length < 3) {
      return res.status(400).json({ msg: "ID ANEM invalide" });
    }

    const recruiter = await getRecruiterWithAnem(req.user.id);
    const user = await User.findById(req.user.id);

    // NEW: Check if recruiter is validated
    if (recruiter.status !== "validated") {
      return res.status(403).json({
        msg: "Votre compte recruteur doit être validé avant de soumettre un ID ANEM",
        code: "RECRUITER_NOT_VALIDATED",
        recruiterStatus: recruiter.status,
      });
    }

    // Check if already registered
    if (recruiter.anem.status === "registered") {
      return res.status(400).json({
        msg: "Vous êtes déjà enregistré ANEM",
        anemId: recruiter.anem.anemId,
      });
    }

    // Get or create registration
    let registration = await AnemRegistration.findOne({
      recruiterId: recruiter._id,
    });

    const trimmedId = anemId.trim().toUpperCase();

    if (!registration) {
      // Create new registration
      registration = new AnemRegistration({
        recruiterId: recruiter._id,
        companyId: recruiter.companyId._id,
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
      // Update existing registration
      const previousId = registration.declaredAnemId;

      // Add to history if different
      const lastHistory =
        registration.anemIdHistory[registration.anemIdHistory.length - 1];
      if (!lastHistory || lastHistory.anemId !== trimmedId) {
        registration.anemIdHistory.push({
          anemId: trimmedId,
          submittedAt: new Date(),
          status: "pending",
        });
      } else if (lastHistory.status === "rejected") {
        // Re-submitting same ID after rejection - create new entry
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
    await syncRecruiterAnemStatus(recruiter._id, registration);

    // Mark modal as seen
    await Recruiter.findByIdAndUpdate(recruiter._id, {
      "anem.hasSeenAnemModal": true,
      "anem.modalSeenAt": new Date(),
    });

    // Notify admins
    await notifyAdminsNewDemande(registration, user.nom, "self_declared");

    res.status(201).json({
      msg: "ID ANEM soumis pour vérification. Vous serez notifié du résultat.",
      status: "pending_verification",
      registrationId: registration._id,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Start or get existing registration form
 * (User chose to register via the website)
 */
export const startRegistration = async (req, res) => {
  try {
    const recruiter = await getRecruiterWithAnem(req.user.id);
    const user = await User.findById(req.user.id);

    // NEW: Check if recruiter is validated
    if (recruiter.status !== "validated") {
      return res.status(403).json({
        msg: "Votre compte recruteur doit être validé avant de soumettre un ID ANEM",
        code: "RECRUITER_NOT_VALIDATED",
        recruiterStatus: recruiter.status,
      });
    }

    // Check if already registered
    if (recruiter.anem.status === "registered") {
      return res.status(400).json({
        msg: "Vous êtes déjà enregistré ANEM",
        anemId: recruiter.anem.anemId,
      });
    }

    // Check for existing registration
    let registration = await AnemRegistration.findOne({
      recruiterId: recruiter._id,
    });

    if (registration) {
      // If failed or rejected, allow restart
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
        // Convert from self-declared to site registration
        registration.registrationType = "site_registration";
        registration.status = "draft";
        registration.currentStep = 1;
        registration.formCompleted = false;

        registration.addAuditEntry(
          "created",
          req.user.id,
          { newValue: { action: "convert_to_site_registration" } },
          req,
        );

        await registration.save();
      }
      // If draft, continue with existing
    } else {
      // Create new registration
      registration = new AnemRegistration({
        recruiterId: recruiter._id,
        companyId: recruiter.companyId._id,
        userId: req.user.id,
        registrationType: "site_registration",
        status: "draft",
        currentStep: 1,
        // Pre-fill step4 email
        step4: {
          email: user.email,
        },
      });

      registration.addAuditEntry(
        "created",
        req.user.id,
        { newValue: { registrationType: "site_registration" } },
        req,
      );

      await registration.save();
    }

    await syncRecruiterAnemStatus(recruiter._id, registration);

    // Mark modal as seen
    await Recruiter.findByIdAndUpdate(recruiter._id, {
      "anem.hasSeenAnemModal": true,
      "anem.modalSeenAt": new Date(),
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

/**
 * Save a step of the registration form (auto-save)
 */
export const saveRegistrationStep = async (req, res) => {
  try {
    const { step, data } = req.body;

    if (!step || step < 1 || step > 4) {
      return res.status(400).json({ msg: "Étape invalide (1-4)" });
    }

    const recruiter = await Recruiter.findOne({ userId: req.user.id });
    if (!recruiter) {
      return res.status(404).json({ msg: "Profil recruteur introuvable" });
    }

    const registration = await AnemRegistration.findOne({
      recruiterId: recruiter._id,
      registrationType: "site_registration",
      status: "draft",
    });

    if (!registration) {
      return res.status(404).json({
        msg: "Aucune inscription en cours. Veuillez recommencer.",
        code: "NO_DRAFT_REGISTRATION",
      });
    }

    // Save step data
    const stepKey = `step${step}`;
    registration[stepKey] = { ...registration[stepKey], ...data };

    // Track consent timestamp
    if (
      step === 4 &&
      data.consentementRgpd &&
      !registration.step4?.consentementAt
    ) {
      registration.step4.consentementAt = new Date();
    }

    // Update current step if progressing
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

/**
 * Validate and submit the completed registration form
 */
export const submitRegistration = async (req, res) => {
  try {
    const recruiter = await getRecruiterWithAnem(req.user.id);
    const user = await User.findById(req.user.id);

    const registration = await AnemRegistration.findOne({
      recruiterId: recruiter._id,
      registrationType: "site_registration",
      status: "draft",
    });

    if (!registration) {
      return res.status(404).json({
        msg: "Aucune inscription en cours trouvée",
        code: "NO_DRAFT_REGISTRATION",
      });
    }

    // Validate all required fields
    const validation = {
      step1: {
        valid: true,
        missing: [],
      },
      step2: {
        valid: true,
        missing: [],
      },
      step3: {
        valid: true,
        missing: [],
      },
      step4: {
        valid: true,
        missing: [],
      },
    };

    // Step 1 validation
    const step1Required = [
      "numeroCnas",
      "raisonSociale",
      "denominationCommerciale",
      "nif",
    ];
    step1Required.forEach((field) => {
      if (
        !registration.step1?.[field] ||
        registration.step1[field].toString().trim() === ""
      ) {
        validation.step1.valid = false;
        validation.step1.missing.push(field);
      }
    });

    // Step 2 validation
    const step2Required = [
      "secteurActivite",
      "brancheActivite",
      "secteurJuridique",
      "statutJuridique",
      "adresse",
      "wilaya",
      "commune",
    ];
    step2Required.forEach((field) => {
      if (
        !registration.step2?.[field] ||
        registration.step2[field].toString().trim() === ""
      ) {
        validation.step2.valid = false;
        validation.step2.missing.push(field);
      }
    });

    // Step 3 validation
    if (
      registration.step3?.effectifDeclare === undefined ||
      registration.step3?.effectifDeclare === null
    ) {
      validation.step3.valid = false;
      validation.step3.missing.push("effectifDeclare");
    }
    if (
      registration.step3?.dontInseresCta === undefined ||
      registration.step3?.dontInseresCta === null
    ) {
      validation.step3.valid = false;
      validation.step3.missing.push("dontInseresCta");
    }
    if (
      registration.step3?.nombreInseresDaip === undefined ||
      registration.step3?.nombreInseresDaip === null
    ) {
      validation.step3.valid = false;
      validation.step3.missing.push("nombreInseresDaip");
    }

    // Step 4 validation
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

    // Mark as submitted
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
    await syncRecruiterAnemStatus(recruiter._id, registration);

    // Notify admins
    await notifyAdminsNewDemande(registration, user.nom, "site_registration");

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

/**
 * Get current registration form data (for continuing a draft)
 */
export const getRegistrationForm = async (req, res) => {
  try {
    const recruiter = await Recruiter.findOne({ userId: req.user.id });
    if (!recruiter) {
      return res.status(404).json({ msg: "Profil recruteur introuvable" });
    }

    const registration = await AnemRegistration.findOne({
      recruiterId: recruiter._id,
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

        // Form data
        step1: registration.step1 || {},
        step2: registration.step2 || {},
        step3: registration.step3 || {},
        step4: {
          email: registration.step4?.email || user.email,
          consentementRgpd: registration.step4?.consentementRgpd || false,
          consentementAt: registration.step4?.consentementAt,
        },

        // Self-declared data
        declaredAnemId: registration.declaredAnemId,
        verifiedAnemId: registration.verifiedAnemId,

        // Status info
        failureReason: registration.failureReason,
        rejectionReason: registration.rejectionReason,

        // Public admin notes
        publicNotes: registration.adminNotes
          ?.filter((n) => n.isPublic)
          .map((n) => ({
            content: n.content,
            createdAt: n.createdAt,
            adminName: n.createdBy?.nom,
          }))
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),

        // ANEM ID history for rejected cases
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

// ============================================
// ADMIN ENDPOINTS
// ============================================

/**
 * Get all ANEM demandes with filters and pagination
 */
export const getAnemDemandes = async (req, res) => {
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

    let query = {
      status: { $ne: "draft" }, // Don't show drafts to admins
    };

    // Status filter
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

    // Registration type filter
    if (registrationType) {
      query.registrationType = registrationType;
    }

    // Wilaya filter
    if (wilaya) {
      query["step2.wilaya"] = { $regex: new RegExp(wilaya, "i") };
    }

    // Assignment filter
    if (assignedTo) {
      query.assignedTo = assignedTo;
    }
    if (unassigned === "true") {
      query.assignedTo = { $exists: false };
    }

    // Date range filter
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) {
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        query.createdAt.$lte = endDate;
      }
    }

    // Search filter
    if (search) {
      const searchRegex = { $regex: search, $options: "i" };

      // Find matching users
      const matchingUsers = await User.find({
        $or: [{ nom: searchRegex }, { email: searchRegex }],
      }).select("_id");
      const userIds = matchingUsers.map((u) => u._id);

      query.$or = [
        { userId: { $in: userIds } },
        { "step1.raisonSociale": searchRegex },
        { "step1.numeroCnas": searchRegex },
        { "step1.nif": searchRegex },
        { declaredAnemId: searchRegex },
        { verifiedAnemId: searchRegex },
      ];
    }

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

    const [demandes, total, statusCounts] = await Promise.all([
      AnemRegistration.find(query)
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .populate("userId", "nom email")
        .populate("companyId", "name logo")
        .populate("recruiterId", "position telephone")
        .populate("assignedTo", "userId label")
        .lean(),
      AnemRegistration.countDocuments(query),
      AnemRegistration.aggregate([
        { $match: { status: { $ne: "draft" } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);

    // Enrich with assigned admin names
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

          // IDs
          declaredAnemId: d.declaredAnemId,
          verifiedAnemId: d.verifiedAnemId,

          // Recruiter/Company info
          recruiter: {
            _id: d.recruiterId?._id,
            nom: d.userId?.nom,
            email: d.userId?.email,
            telephone: d.recruiterId?.telephone,
          },
          company: {
            _id: d.companyId?._id,
            name: d.companyId?.name,
            logo: d.companyId?.logo,
          },

          // Location
          wilaya: d.step2?.wilaya,
          raisonSociale: d.step1?.raisonSociale,

          // Assignment
          assignedTo: d.assignedTo
            ? {
                _id: d.assignedTo._id,
                name: assignedAdminName,
                label: d.assignedTo.label,
              }
            : null,
          assignedAt: d.assignedAt,

          // PDF tracking
          pdfDownloadCount: d.pdfDownloads?.length || 0,
          lastPdfDownload: d.pdfDownloads?.slice(-1)[0]?.downloadedAt,

          // Status info
          failureReason: d.failureReason,
          rejectionReason: d.rejectionReason,

          // Timestamps
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        };
      }),
    );

    // Build status counts map
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

/**
 * Get single demande details with full audit log
 */
export const getDemandeDetails = async (req, res) => {
  try {
    const { demandeId } = req.params;

    const demande = await AnemRegistration.findById(demandeId)
      .populate("userId", "nom email createdAt")
      .populate("companyId", "name logo website location status")
      .populate("recruiterId", "position telephone status")
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

    // Get assigned admin name
    let assignedAdminName = null;
    if (demande.assignedTo?.userId) {
      const adminUser = await User.findById(demande.assignedTo.userId).select(
        "nom",
      );
      assignedAdminName = adminUser?.nom;
    }

    // Log view action
    await logAdminAction(
      req.user.id,
      "anem_demande_viewed",
      { type: "anem_registration", id: demande._id },
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

/**
 * Get pending ANEM IDs awaiting verification (separate list)
 */
export const getPendingAnemIds = async (req, res) => {
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
      AnemRegistration.find({
        registrationType: "self_declared",
        status: "pending_verification",
      })
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .populate("userId", "nom email")
        .populate("companyId", "name logo")
        .populate("recruiterId", "position")
        .lean(),
      AnemRegistration.countDocuments({
        registrationType: "self_declared",
        status: "pending_verification",
      }),
    ]);

    const enriched = demandes.map((d) => ({
      _id: d._id,
      declaredAnemId: d.declaredAnemId,
      declaredAt: d.declaredAt,
      recruiter: {
        _id: d.recruiterId?._id,
        nom: d.userId?.nom,
        email: d.userId?.email,
      },
      company: {
        _id: d.companyId?._id,
        name: d.companyId?.name,
        logo: d.companyId?.logo,
      },
      // Show history of previous submissions
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

/**
 * Assign demande to an admin
 */
export const assignDemande = async (req, res) => {
  try {
    const { demandeId } = req.params;
    const { adminId } = req.body;

    const demande = await AnemRegistration.findById(demandeId);
    if (!demande) {
      return res.status(404).json({ msg: "Demande introuvable" });
    }

    let targetAdminId = adminId;

    // If no adminId provided, assign to self
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
      "anem_demande_assigned",
      { type: "anem_registration", id: demande._id },
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

/**
 * Mark demande as in progress (admin has started processing)
 */
export const markInProgress = async (req, res) => {
  try {
    const { demandeId } = req.params;

    const demande = await AnemRegistration.findById(demandeId);
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

    // Auto-assign if not assigned
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
    await syncRecruiterAnemStatus(demande.recruiterId, demande);

    // Notify recruiter
    await Notification.create({
      userId: demande.userId,
      message:
        "Votre demande d'inscription ANEM est en cours de traitement par notre équipe.",
      type: "info",
    });

    await logAdminAction(
      req.user.id,
      "anem_demande_in_progress",
      { type: "anem_registration", id: demande._id },
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

/**
 * Get PDF data as JSON (frontend will convert to PDF)
 */
export const getPdfData = async (req, res) => {
  try {
    const { demandeId } = req.params;

    const demande = await AnemRegistration.findById(demandeId);
    if (!demande) {
      return res.status(404).json({ msg: "Demande introuvable" });
    }

    // Record download
    demande.pdfDownloads.push({
      downloadedBy: req.user.id,
      downloadedAt: new Date(),
      ip: req.ip || req.connection?.remoteAddress,
    });

    demande.addAuditEntry("pdf_downloaded", req.user.id, {}, req);

    await demande.save();

    // Generate PDF data
    const pdfData = await demande.generatePdfData();

    await logAdminAction(
      req.user.id,
      "anem_pdf_downloaded",
      { type: "anem_registration", id: demande._id },
      {},
      req,
    );

    res.json(pdfData);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Approve self-declared ANEM ID
 */
export const approveAnemId = async (req, res) => {
  try {
    const { demandeId } = req.params;
    const { comment } = req.body;

    const demande = await AnemRegistration.findById(demandeId);
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

    // Update history
    const lastHistory = demande.anemIdHistory[demande.anemIdHistory.length - 1];
    if (lastHistory && lastHistory.status === "pending") {
      lastHistory.status = "approved";
      lastHistory.reviewedBy = req.user.id;
      lastHistory.reviewedAt = new Date();
      lastHistory.adminComment = comment;
    }

    // Add public note if comment provided
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
    await syncRecruiterAnemStatus(demande.recruiterId, demande);

    // Notify recruiter
    await Notification.create({
      userId: demande.userId,
      message: `Félicitations ! Votre ID ANEM (${demande.verifiedAnemId}) a été vérifié avec succès. Vous pouvez maintenant publier des offres via ANEM.`,
      type: "validation",
    });

    await logAdminAction(
      req.user.id,
      "anem_id_approved",
      { type: "anem_registration", id: demande._id },
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

/**
 * Reject self-declared ANEM ID
 */
export const rejectAnemId = async (req, res) => {
  try {
    const { demandeId } = req.params;
    const { reason, publicMessage } = req.body;

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ msg: "Raison de rejet requise" });
    }

    const demande = await AnemRegistration.findById(demandeId);
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

    // Update history
    const lastHistory = demande.anemIdHistory[demande.anemIdHistory.length - 1];
    if (lastHistory && lastHistory.status === "pending") {
      lastHistory.status = "rejected";
      lastHistory.reviewedBy = req.user.id;
      lastHistory.reviewedAt = new Date();
      lastHistory.rejectionReason = reason;
    }

    // Add public note
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
    await syncRecruiterAnemStatus(demande.recruiterId, demande);

    // Notify recruiter
    await Notification.create({
      userId: demande.userId,
      message: `Votre ID ANEM n'a pas pu être vérifié. Raison: ${reason}. Vous pouvez soumettre un nouvel ID ou vous inscrire via notre site.`,
      type: "alerte",
    });

    await logAdminAction(
      req.user.id,
      "anem_id_rejected",
      { type: "anem_registration", id: demande._id },
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

/**
 * Mark registration as successful (after physical ANEM registration)
 */
export const markRegistered = async (req, res) => {
  try {
    const { demandeId } = req.params;
    const { anemId, message } = req.body;

    if (!anemId || anemId.trim().length < 3) {
      return res.status(400).json({ msg: "ID ANEM valide requis" });
    }

    const demande = await AnemRegistration.findById(demandeId);
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

    // Add public note with success message
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
    await syncRecruiterAnemStatus(demande.recruiterId, demande);

    // Notify recruiter
    await Notification.create({
      userId: demande.userId,
      message: `Félicitations ! Vous êtes maintenant enregistré auprès de l'ANEM. Votre ID ANEM: ${trimmedId}`,
      type: "validation",
    });

    await logAdminAction(
      req.user.id,
      "anem_registration_success",
      { type: "anem_registration", id: demande._id },
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

/**
 * Mark registration as failed
 */
export const markFailed = async (req, res) => {
  try {
    const { demandeId } = req.params;
    const { reason, publicMessage } = req.body;

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ msg: "Raison de l'échec requise" });
    }

    const demande = await AnemRegistration.findById(demandeId);
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

    // Add public note
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
    await syncRecruiterAnemStatus(demande.recruiterId, demande);

    // Notify recruiter
    await Notification.create({
      userId: demande.userId,
      message: `Nous n'avons pas pu finaliser votre inscription ANEM. Raison: ${reason}. Vous pouvez réessayer en soumettant une nouvelle demande.`,
      type: "alerte",
    });

    await logAdminAction(
      req.user.id,
      "anem_registration_failed",
      { type: "anem_registration", id: demande._id },
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

/**
 * Add admin note to demande
 */
export const addAdminNote = async (req, res) => {
  try {
    const { demandeId } = req.params;
    const { note, isPublic = false } = req.body;

    if (!note || note.trim().length === 0) {
      return res.status(400).json({ msg: "Note requise" });
    }

    const demande = await AnemRegistration.findById(demandeId);
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

    // If public, notify recruiter
    if (isPublic) {
      await Notification.create({
        userId: demande.userId,
        message: `Mise à jour concernant votre demande ANEM: ${note.substring(0, 100)}${note.length > 100 ? "..." : ""}`,
        type: "info",
      });
    }

    await logAdminAction(
      req.user.id,
      "anem_note_added",
      { type: "anem_registration", id: demande._id },
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

/**
 * Bulk update demandes status
 */
export const bulkUpdateStatus = async (req, res) => {
  try {
    const { demandeIds, status, reason, anemId, message } = req.body;

    if (!demandeIds || !Array.isArray(demandeIds) || demandeIds.length === 0) {
      return res.status(400).json({ msg: "IDs de demandes requis" });
    }

    if (!["in_progress", "registered", "failed"].includes(status)) {
      return res.status(400).json({
        msg: "Statut invalide. Utilisez: in_progress, registered, failed",
      });
    }

    if (status === "registered" && (!anemId || anemId.trim().length < 3)) {
      return res.status(400).json({
        msg: "ID ANEM valide requis pour marquer comme enregistré",
      });
    }

    if (status === "failed" && (!reason || reason.trim().length === 0)) {
      return res.status(400).json({
        msg: "Raison requise pour marquer comme échoué",
      });
    }

    const results = {
      success: [],
      failed: [],
    };

    for (const demandeId of demandeIds) {
      try {
        const demande = await AnemRegistration.findById(demandeId);

        if (!demande) {
          results.failed.push({ id: demandeId, reason: "Demande introuvable" });
          continue;
        }

        // Check valid status transition
        if (status === "registered" || status === "failed") {
          if (!["pending", "in_progress"].includes(demande.status)) {
            results.failed.push({
              id: demandeId,
              reason: `Transition invalide de ${demande.status} vers ${status}`,
            });
            continue;
          }
        } else if (status === "in_progress") {
          if (!["pending", "pending_verification"].includes(demande.status)) {
            results.failed.push({
              id: demandeId,
              reason: `Transition invalide de ${demande.status} vers ${status}`,
            });
            continue;
          }
        }

        const previousStatus = demande.status;
        demande.status = status;

        if (status === "registered") {
          const trimmedId = anemId.trim().toUpperCase();
          demande.verifiedAnemId = trimmedId;
          demande.verifiedAt = new Date();
          demande.verifiedBy = req.user.id;

          demande.adminNotes.push({
            content: message || `Inscription ANEM réussie. ID: ${trimmedId}`,
            createdBy: req.user.id,
            isPublic: true,
          });

          await Notification.create({
            userId: demande.userId,
            message: `Félicitations ! Vous êtes enregistré ANEM. ID: ${trimmedId}`,
            type: "validation",
          });
        } else if (status === "failed") {
          demande.failureReason = reason;

          demande.adminNotes.push({
            content: message || `Inscription échouée: ${reason}`,
            createdBy: req.user.id,
            isPublic: true,
          });

          await Notification.create({
            userId: demande.userId,
            message: `Votre inscription ANEM a échoué. Raison: ${reason}`,
            type: "alerte",
          });
        } else if (status === "in_progress") {
          // Auto-assign if not assigned
          if (!demande.assignedTo) {
            const selfAdmin = await Admin.findOne({ userId: req.user.id });
            if (selfAdmin) {
              demande.assignedTo = selfAdmin._id;
              demande.assignedAt = new Date();
              demande.assignedBy = req.user.id;
            }
          }

          await Notification.create({
            userId: demande.userId,
            message: "Votre demande ANEM est en cours de traitement.",
            type: "info",
          });
        }

        demande.addAuditEntry(
          "status_changed",
          req.user.id,
          { previousValue: previousStatus, newValue: status },
          req,
        );

        await demande.save();
        await syncRecruiterAnemStatus(demande.recruiterId, demande);

        results.success.push(demandeId);
      } catch (err) {
        results.failed.push({ id: demandeId, reason: err.message });
      }
    }

    await logAdminAction(
      req.user.id,
      "anem_bulk_status_update",
      { type: "anem_registration", id: demandeIds.join(",") },
      {
        status,
        successCount: results.success.length,
        failedCount: results.failed.length,
      },
      req,
    );

    res.json({
      msg: `${results.success.length} demande(s) mise(s) à jour avec succès`,
      results,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Get ANEM statistics for admin dashboard
 */
export const getAnemStats = async (req, res) => {
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
      anemOffersStats,
      dailyDemandes,
      wilayaDistribution,
    ] = await Promise.all([
      // Status counts (excluding drafts)
      AnemRegistration.aggregate([
        { $match: { status: { $ne: "draft" } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),

      // New demandes this week
      AnemRegistration.countDocuments({
        status: { $ne: "draft" },
        createdAt: { $gte: sevenDaysAgo },
      }),

      // New demandes this month
      AnemRegistration.countDocuments({
        status: { $ne: "draft" },
        createdAt: { $gte: thirtyDaysAgo },
      }),

      // Pending older than 7 days (action needed)
      AnemRegistration.countDocuments({
        status: { $in: ["pending", "pending_verification"] },
        createdAt: { $lt: sevenDaysAgo },
      }),

      // Registrations by type
      AnemRegistration.aggregate([
        { $match: { status: { $ne: "draft" } } },
        { $group: { _id: "$registrationType", count: { $sum: 1 } } },
      ]),

      // Average processing time (for completed registrations)
      AnemRegistration.aggregate([
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

      // ANEM offers stats
      Promise.all([
        AnemOffer.countDocuments({ anemEnabled: true }),
        Offer.countDocuments({ actif: true, validationStatus: "approved" }),
      ]),

      // Daily demandes for chart (last 30 days)
      AnemRegistration.aggregate([
        {
          $match: {
            status: { $ne: "draft" },
            createdAt: { $gte: thirtyDaysAgo },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            total: { $sum: 1 },
            siteRegistrations: {
              $sum: {
                $cond: [
                  { $eq: ["$registrationType", "site_registration"] },
                  1,
                  0,
                ],
              },
            },
            selfDeclared: {
              $sum: {
                $cond: [{ $eq: ["$registrationType", "self_declared"] }, 1, 0],
              },
            },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      // Wilaya distribution
      AnemRegistration.aggregate([
        {
          $match: {
            status: { $ne: "draft" },
            "step2.wilaya": { $exists: true },
          },
        },
        { $group: { _id: "$step2.wilaya", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
    ]);

    // Build status counts map
    const countsMap = {};
    statusCounts.forEach((s) => {
      countsMap[s._id] = s.count;
    });

    // Build registration type map
    const typeMap = {};
    registrationsByType.forEach((t) => {
      typeMap[t._id] = t.count;
    });

    // Calculate totals
    const totalDemandes = Object.values(countsMap).reduce((a, b) => a + b, 0);
    const successfulRegistrations = countsMap["registered"] || 0;
    const successRate =
      totalDemandes > 0
        ? Math.round((successfulRegistrations / totalDemandes) * 100)
        : 0;

    // ANEM offer stats
    const [anemOffersCount, totalActiveOffers] = anemOffersStats;
    const anemOfferPercentage =
      totalActiveOffers > 0
        ? Math.round((anemOffersCount / totalActiveOffers) * 100)
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

      offers: {
        withAnem: anemOffersCount,
        withoutAnem: totalActiveOffers - anemOffersCount,
        total: totalActiveOffers,
        anemPercentage: `${anemOfferPercentage}%`,
      },

      charts: {
        dailyDemandes,
        wilayaDistribution,
      },

      statusCounts: countsMap,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Get new demandes count (for notification badge)
 */
export const getNewDemandesCount = async (req, res) => {
  try {
    const [pendingCount, unassignedCount] = await Promise.all([
      AnemRegistration.countDocuments({
        status: { $in: ["pending", "pending_verification"] },
      }),
      AnemRegistration.countDocuments({
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

/**
 * Get list of admins for assignment dropdown
 */
export const getAdminsForAssignment = async (req, res) => {
  try {
    const admins = await Admin.find({
      status: "active",
      $or: [
        { label: "super_admin" },
        { "permissions.validateRecruiters": true },
      ],
    })
      .populate("userId", "nom email")
      .select("userId label");

    const adminList = admins.map((a) => ({
      _id: a._id,
      name: a.userId?.nom,
      email: a.userId?.email,
      label: a.label,
    }));

    res.json(adminList);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};
