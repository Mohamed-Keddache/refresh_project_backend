// === controllers/anemOfferController.js ===
import AnemOffer from "../models/AnemOffer.js";
import AnemRegistration from "../models/AnemRegistration.js";
import Offer from "../models/Offer.js";
import Recruiter from "../models/Recruiter.js";

/**
 * Check ANEM eligibility before/during offer creation
 */
export const checkAnemEligibility = async (req, res) => {
  try {
    const recruiter = await Recruiter.findOne({ userId: req.user.id });

    if (!recruiter) {
      return res.status(404).json({ msg: "Profil recruteur introuvable" });
    }

    const offerCount = await Offer.countDocuments({
      recruteurId: recruiter._id,
    });

    const isFirstOffer = offerCount === 0;
    const isAnemRegistered = recruiter.canCreateAnemOffer();
    const hasSeenModal = recruiter.anem.hasSeenAnemModal;
    const declinedAnem = recruiter.anem.declinedAnem;
    const currentStatus = recruiter.anem.status;

    // Determine if ANEM modal should show
    let showModal = false;
    let modalType = null;

    // First offer: always show modal if not seen
    if (isFirstOffer && !hasSeenModal) {
      showModal = true;
      modalType = "first_offer";
    }

    res.json({
      // Offer context
      isFirstOffer,
      offerCount,

      // ANEM status
      isAnemRegistered,
      anemId: recruiter.anem.anemId,
      anemStatus: currentStatus,

      // Modal state
      hasSeenModal,
      declinedAnem,
      showModal,
      modalType,

      // Capabilities
      canEnableAnem: isAnemRegistered,
      canToggleAnem: isAnemRegistered, // For toggle in offer form
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Create ANEM association when creating offer with ANEM enabled
 */
export const createAnemOffer = async (
  offerId,
  recruiterId,
  anemRegistrationId,
  anemId,
) => {
  try {
    const anemOffer = new AnemOffer({
      offerId,
      recruiterId,
      anemRegistrationId,
      anemEnabled: true,
      anemId,
      enabledAt: new Date(),
    });

    await anemOffer.save();
    return anemOffer;
  } catch (err) {
    console.error("Error creating ANEM offer:", err);
    throw err;
  }
};

/**
 * Enable ANEM for an existing offer
 */
export const enableAnemForOffer = async (req, res) => {
  try {
    const { offerId } = req.params;

    const recruiter = await Recruiter.findOne({ userId: req.user.id });
    if (!recruiter) {
      return res.status(404).json({ msg: "Profil recruteur introuvable" });
    }

    if (!recruiter.canCreateAnemOffer()) {
      return res.status(403).json({
        msg: "Vous devez être enregistré ANEM pour activer cette fonctionnalité",
        anemStatus: recruiter.anem.status,
        needsRegistration: true,
      });
    }

    const offer = await Offer.findOne({
      _id: offerId,
      recruteurId: recruiter._id,
    });

    if (!offer) {
      return res.status(404).json({ msg: "Offre introuvable" });
    }

    // Check if already has ANEM data
    let anemOffer = await AnemOffer.findOne({ offerId });

    if (anemOffer) {
      if (anemOffer.anemEnabled) {
        return res
          .status(400)
          .json({ msg: "ANEM déjà activé pour cette offre" });
      }

      anemOffer.anemEnabled = true;
      anemOffer.anemId = recruiter.anem.anemId;
      anemOffer.enabledAt = new Date();
      anemOffer.disabledAt = undefined;
    } else {
      anemOffer = new AnemOffer({
        offerId,
        recruiterId: recruiter._id,
        anemRegistrationId: recruiter.anem.registrationId,
        anemEnabled: true,
        anemId: recruiter.anem.anemId,
        enabledAt: new Date(),
      });
    }

    await anemOffer.save();

    res.json({
      msg: "ANEM activé pour cette offre",
      anemEnabled: true,
      anemId: anemOffer.anemId,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Disable ANEM for an offer
 */
export const disableAnemForOffer = async (req, res) => {
  try {
    const { offerId } = req.params;

    const recruiter = await Recruiter.findOne({ userId: req.user.id });
    if (!recruiter) {
      return res.status(404).json({ msg: "Profil recruteur introuvable" });
    }

    const offer = await Offer.findOne({
      _id: offerId,
      recruteurId: recruiter._id,
    });

    if (!offer) {
      return res.status(404).json({ msg: "Offre introuvable" });
    }

    const anemOffer = await AnemOffer.findOne({ offerId });

    if (!anemOffer || !anemOffer.anemEnabled) {
      return res
        .status(400)
        .json({ msg: "ANEM n'est pas activé pour cette offre" });
    }

    anemOffer.anemEnabled = false;
    anemOffer.disabledAt = new Date();
    await anemOffer.save();

    res.json({
      msg: "ANEM désactivé pour cette offre",
      anemEnabled: false,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Get ANEM status for a specific offer
 */
export const getOfferAnemStatus = async (req, res) => {
  try {
    const { offerId } = req.params;

    const recruiter = await Recruiter.findOne({ userId: req.user.id });
    if (!recruiter) {
      return res.status(404).json({ msg: "Profil recruteur introuvable" });
    }

    const offer = await Offer.findOne({
      _id: offerId,
      recruteurId: recruiter._id,
    });

    if (!offer) {
      return res.status(404).json({ msg: "Offre introuvable" });
    }

    const anemOffer = await AnemOffer.findOne({ offerId }).lean();

    res.json({
      hasAnem: anemOffer?.anemEnabled || false,
      anemEnabled: anemOffer?.anemEnabled || false,
      anemId: anemOffer?.anemId,
      enabledAt: anemOffer?.enabledAt,
      // Future API integration
      submittedToAnem: anemOffer?.submittedToAnem || false,
      anemReference: anemOffer?.anemReference,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Get all offers with ANEM status for a recruiter
 */
export const getRecruiterAnemOffers = async (req, res) => {
  try {
    const recruiter = await Recruiter.findOne({ userId: req.user.id });
    if (!recruiter) {
      return res.status(404).json({ msg: "Profil recruteur introuvable" });
    }

    const offers = await Offer.find({ recruteurId: recruiter._id })
      .select("_id titre actif validationStatus datePublication")
      .lean();

    const offerIds = offers.map((o) => o._id);
    const anemOffers = await AnemOffer.find({
      offerId: { $in: offerIds },
    }).lean();
    const anemMap = new Map(anemOffers.map((a) => [a.offerId.toString(), a]));

    const enriched = offers.map((offer) => {
      const anem = anemMap.get(offer._id.toString());
      return {
        ...offer,
        anem: anem
          ? {
              enabled: anem.anemEnabled,
              anemId: anem.anemId,
              enabledAt: anem.enabledAt,
            }
          : null,
      };
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};
