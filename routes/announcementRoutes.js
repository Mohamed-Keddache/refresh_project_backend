import express from "express";
import auth from "../middleware/auth.js";
import {
  getActiveAnnouncements,
  dismissAnnouncement,
} from "../controllers/announcementController.js";

const router = express.Router();

router.use(auth);

router.get("/active", getActiveAnnouncements);

router.post("/:announcementId/dismiss", dismissAnnouncement);

export default router;
