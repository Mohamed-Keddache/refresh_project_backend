import express from "express";
import {
  getAllActiveOffers,
  getOfferDetails,
} from "../controllers/offerController.js";

const router = express.Router();

router.get("/", getAllActiveOffers);

router.get("/:id", getOfferDetails);

export default router;
