import express from "express";
import auth from "../middleware/auth.js";
import {
  getMyNotifications,
  getUnreadCount,
  markAsRead,
} from "../controllers/notificationController.js";

const router = express.Router();

router.use(auth);

router.get("/", getMyNotifications);
router.get("/unread-count", getUnreadCount);
router.put("/:id/read", markAsRead);

export default router;
