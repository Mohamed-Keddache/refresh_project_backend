import express from "express";
import auth from "../middleware/auth.js";
import {
  getMyNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
} from "../controllers/notificationController.js";

const router = express.Router();

router.use(auth);

router.get("/", getMyNotifications);
router.get("/unread-count", getUnreadCount);

// FEATURE 2.1: Marquer toutes les notifications comme lues
router.put("/read-all", markAllAsRead);

router.put("/:id/read", markAsRead);

// FEATURE 2.1: Supprimer une notification
router.delete("/:id", deleteNotification);

export default router;
