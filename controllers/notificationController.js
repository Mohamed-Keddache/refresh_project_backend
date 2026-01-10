import Notification from "../models/Notification.js";

export const getMyNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.user.id }).sort(
      {
        date: -1,
      }
    );
    res.json(notifications);
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
      { new: true }
    );

    if (!notification)
      return res.status(404).json({ msg: "Notification introuvable" });

    res.json(notification);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};
