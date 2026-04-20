import Notification from "../models/Notification.js";
import { emitNotificationCount } from "../services/socketEvents.js";

export const getMyNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const [notifications, total] = await Promise.all([
      Notification.find({ userId: req.user.id })
        .sort({ date: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Notification.countDocuments({ userId: req.user.id }),
    ]);

    res.json({
      data: notifications,
      meta: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getUnreadCount = async (req, res) => {
  try {
    const count = await Notification.countDocuments({
      userId: req.user.id,
      lu: false,
    });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const markAsRead = async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { lu: true },
      { new: true },
    );

    if (!notification)
      return res.status(404).json({ msg: "Notification introuvable" });

    await emitNotificationCount(req.user.id);

    res.json(notification);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// ══════════════════════════════════════════════════════════════
// FEATURE 2.1: Marquer toutes les notifications comme lues
// ══════════════════════════════════════════════════════════════
export const markAllAsRead = async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { userId: req.user.id, lu: false },
      { lu: true },
    );

    await emitNotificationCount(req.user.id);

    res.json({
      msg: "Toutes les notifications ont été marquées comme lues ✅",
      modifiedCount: result.modifiedCount,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// ══════════════════════════════════════════════════════════════
// FEATURE 2.1: Supprimer une notification
// ══════════════════════════════════════════════════════════════
export const deleteNotification = async (req, res) => {
  try {
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!notification)
      return res.status(404).json({ msg: "Notification introuvable" });

    await emitNotificationCount(req.user.id);

    res.json({ msg: "Notification supprimée 🗑️" });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};
