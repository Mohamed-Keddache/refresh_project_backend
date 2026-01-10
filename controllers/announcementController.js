import Announcement from "../models/Announcement.js";
import User from "../models/User.js";
import Admin from "../models/Admin.js";
import { logAdminAction } from "../models/AdminLog.js";

export const createAnnouncement = async (req, res) => {
  try {
    const {
      title,
      content,
      targetAudience,
      status,
      publishAt,
      expiresAt,
      priority,
      displayType,
    } = req.body;

    let finalStatus = status || "draft";
    if (
      status === "published" &&
      publishAt &&
      new Date(publishAt) > new Date()
    ) {
      finalStatus = "scheduled";
    }

    const announcement = await Announcement.create({
      title,
      content,
      targetAudience: targetAudience || "all",
      status: finalStatus,
      publishAt: publishAt ? new Date(publishAt) : null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      priority: priority || "normal",
      displayType: displayType || "inline",
      createdBy: req.user.id,
    });

    await logAdminAction(
      req.user.id,
      "announcement_created",
      { type: "announcement", id: announcement._id },
      { title },
      req
    );

    res.status(201).json({ msg: "Annonce créée ✅", announcement });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getAllAnnouncements = async (req, res) => {
  try {
    const { status, targetAudience, page = 1, limit = 20 } = req.query;

    let query = {};
    if (status) query.status = status;
    if (targetAudience) query.targetAudience = targetAudience;

    const announcements = await Announcement.find(query)
      .populate("createdBy", "nom email")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Announcement.countDocuments(query);

    res.json({
      data: announcements,
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

export const getActiveAnnouncements = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const now = new Date();

    let audienceFilter = ["all"];
    if (user.role === "admin") audienceFilter.push("admins");
    if (user.role === "recruteur") audienceFilter.push("recruiters");
    if (user.role === "candidat") audienceFilter.push("candidates");

    const announcements = await Announcement.find({
      status: "published",
      targetAudience: { $in: audienceFilter },
      $or: [{ publishAt: null }, { publishAt: { $lte: now } }],
      dismissedBy: { $ne: req.user.id },
    })
      .and([
        {
          $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
        },
      ])
      .sort({ priority: -1, createdAt: -1 });

    res.json(announcements);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const updateAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const announcement = await Announcement.findByIdAndUpdate(
      id,
      {
        ...updates,
        updatedBy: req.user.id,
      },
      { new: true }
    );

    if (!announcement) {
      return res.status(404).json({ msg: "Annonce introuvable" });
    }

    await logAdminAction(
      req.user.id,
      "announcement_updated",
      { type: "announcement", id: announcement._id },
      { updates },
      req
    );

    res.json({ msg: "Annonce mise à jour ✅", announcement });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const deleteAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;

    const announcement = await Announcement.findByIdAndDelete(id);
    if (!announcement) {
      return res.status(404).json({ msg: "Annonce introuvable" });
    }

    await logAdminAction(
      req.user.id,
      "announcement_deleted",
      { type: "announcement", id },
      { title: announcement.title },
      req
    );

    res.json({ msg: "Annonce supprimée 🗑️" });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const dismissAnnouncement = async (req, res) => {
  try {
    const { announcementId } = req.params;

    await Announcement.findByIdAndUpdate(announcementId, {
      $addToSet: { dismissedBy: req.user.id },
    });

    res.json({ msg: "Annonce masquée." });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const publishScheduledAnnouncements = async () => {
  const now = new Date();

  const publishedResult = await Announcement.updateMany(
    { status: "scheduled", publishAt: { $lte: now } },
    { $set: { status: "published" } }
  );

  const expiredResult = await Announcement.updateMany(
    { status: "published", expiresAt: { $lte: now } },
    { $set: { status: "expired" } }
  );

  console.log(
    `📢 Annonces publiées: ${publishedResult.modifiedCount}, expirées: ${expiredResult.modifiedCount}`
  );
};
