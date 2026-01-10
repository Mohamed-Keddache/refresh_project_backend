import SupportTicket from "../models/SupportTicket.js";
import Admin from "../models/Admin.js";
import Notification from "../models/Notification.js";
import { logAdminAction } from "../models/AdminLog.js";

export const createTicket = async (req, res) => {
  try {
    const { subject, description, category } = req.body;
    const attachments = req.files?.map((f) => f.path.replace(/\\/g, "/")) || [];

    if (!subject || !description || !category) {
      return res.status(400).json({
        msg: "Sujet, description et catégorie sont obligatoires.",
      });
    }

    const ticket = await SupportTicket.create({
      userId: req.user.id,
      subject,
      description,
      category,
      attachments,
    });

    const admins = await Admin.find({
      label: ticket.assignedToLabel,
      status: "active",
      "permissions.handleSupportTickets": true,
    }).populate("userId", "_id");

    const notifPromises = admins.map((admin) =>
      Notification.create({
        userId: admin.userId._id,
        message: `Nouveau ticket support: "${subject}"`,
        type: "info",
      })
    );
    await Promise.all(notifPromises);

    res.status(201).json({ msg: "Ticket créé avec succès.", ticket });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getMyTickets = async (req, res) => {
  try {
    const tickets = await SupportTicket.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .select("-messages.adminId");

    res.json(tickets);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getTicketDetails = async (req, res) => {
  try {
    const { ticketId } = req.params;

    const ticket = await SupportTicket.findOne({
      _id: ticketId,
      userId: req.user.id,
    });

    if (!ticket) {
      return res.status(404).json({ msg: "Ticket introuvable." });
    }

    res.json(ticket);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const replyToTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { content } = req.body;
    const attachments = req.files?.map((f) => f.path.replace(/\\/g, "/")) || [];

    if (!content) {
      return res.status(400).json({ msg: "Le contenu est obligatoire." });
    }

    const ticket = await SupportTicket.findOne({
      _id: ticketId,
      userId: req.user.id,
      status: { $nin: ["closed"] },
    });

    if (!ticket) {
      return res.status(404).json({ msg: "Ticket introuvable ou fermé." });
    }

    ticket.messages.push({
      from: "user",
      content,
      attachments,
    });

    if (ticket.status === "awaiting_user") {
      ticket.status = "in_progress";
    }

    await ticket.save();

    if (ticket.assignedTo) {
      const admin = await Admin.findById(ticket.assignedTo).populate("userId");
      if (admin) {
        await Notification.create({
          userId: admin.userId._id,
          message: `Nouvelle réponse sur le ticket: "${ticket.subject}"`,
          type: "info",
        });
      }
    }

    res.json({ msg: "Réponse envoyée.", ticket });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};
