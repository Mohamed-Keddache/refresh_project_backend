import express from "express";
import {
  getAllActiveOffers,
  getOfferDetails,
  getOfferFilters,
  getCompanyPublicProfile,
} from "../controllers/offerController.js";

const router = express.Router();

// FEATURE 2.3: Endpoint métadonnées pour les filtres dynamiques
router.get("/filters", getOfferFilters);

router.get("/", getAllActiveOffers);

// FEATURE 2.6: Profil public d'une entreprise
router.get("/companies/:companyId", getCompanyPublicProfile);

router.get("/:id", getOfferDetails);

export default router;
