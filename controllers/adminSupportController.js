import SupportTicket from "../models/SupportTicket.js";
import Admin from "../models/Admin.js";
import Notification from "../models/Notification.js";
import { logAdminAction } from "../models/AdminLog.js";

export const getTicketsByLabel = async (req, res) => {
  try {
    const admin = await Admin.findOne({ userId: req.user.id });

    if (!admin) {
      return res.status(403).json({ msg: "Admin introuvable." });
    }

    const { status, priority, page = 1, limit = 20 } = req.query;

    let query = {};

    if (admin.label !== "super_admin") {
      query.assignedToLabel = admin.label;
    }

    if (status) query.status = status;
    if (priority) query.priority = priority;

    const tickets = await SupportTicket.find(query)
      .populate("userId", "nom email role")
      .populate("assignedTo", "label")
      .sort({ priority: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await SupportTicket.countDocuments(query);

    res.json({
      data: tickets,
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

export const getTicketById = async (req, res) => {
  try {
    const { ticketId } = req.params;

    const ticket = await SupportTicket.findById(ticketId)
      .populate("userId", "nom email role")
      .populate("messages.adminId", "nom");

    if (!ticket) {
      return res.status(404).json({ msg: "Ticket introuvable." });
    }

    res.json(ticket);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const respondToTicket = async (req, res) => {
  try {
    const admin = await Admin.findOne({ userId: req.user.id });
    const { ticketId } = req.params;
    const { content, newStatus } = req.body;
    const attachments = req.files?.map((f) => f.path.replace(/\\/g, "/")) || [];

    if (!content) {
      return res.status(400).json({ msg: "Le contenu est obligatoire." });
    }

    const ticket = await SupportTicket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({ msg: "Ticket introuvable." });
    }

    if (!ticket.assignedTo) {
      ticket.assignedTo = admin._id;
    }

    ticket.messages.push({
      from: "admin",
      content,
      adminId: req.user.id,
      attachments,
    });

    if (newStatus) {
      ticket.status = newStatus;
      if (newStatus === "resolved") ticket.resolvedAt = new Date();
      if (newStatus === "closed") ticket.closedAt = new Date();
    }

    await ticket.save();

    await Notification.create({
      userId: ticket.userId,
      message: `Réponse de l'administration sur votre ticket: "${ticket.subject}"`,
      type: "info",
    });

    await logAdminAction(
      req.user.id,
      "ticket_responded",
      { type: "ticket", id: ticket._id },
      { newStatus },
      req
    );

    res.json({ msg: "Réponse envoyée.", ticket });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const reassignTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { newLabel, newAdminId } = req.body;

    const ticket = await SupportTicket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({ msg: "Ticket introuvable." });
    }

    if (newLabel) ticket.assignedToLabel = newLabel;
    if (newAdminId) {
      const targetAdmin = await Admin.findById(newAdminId);
      if (!targetAdmin) {
        return res.status(404).json({ msg: "Admin cible introuvable." });
      }
      ticket.assignedTo = newAdminId;
    }

    await ticket.save();

    await logAdminAction(
      req.user.id,
      "ticket_reassigned",
      { type: "ticket", id: ticket._id },
      { newLabel, newAdminId },
      req
    );

    res.json({ msg: "Ticket réassigné.", ticket });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const closeTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { resolution } = req.body;

    const ticket = await SupportTicket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({ msg: "Ticket introuvable." });
    }

    ticket.status = "closed";
    ticket.closedAt = new Date();

    if (resolution) {
      ticket.messages.push({
        from: "admin",
        content: `Ticket fermé. Résolution: ${resolution}`,
        adminId: req.user.id,
      });
    }

    await ticket.save();

    await Notification.create({
      userId: ticket.userId,
      message: `Votre ticket "${ticket.subject}" a été fermé.`,
      type: "info",
    });

    await logAdminAction(
      req.user.id,
      "ticket_closed",
      { type: "ticket", id: ticket._id },
      { resolution },
      req
    );

    res.json({ msg: "Ticket fermé.", ticket });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};
