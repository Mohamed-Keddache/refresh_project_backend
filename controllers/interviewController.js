import Interview from "../models/Interview.js";
import Application from "../models/Application.js";
import Offer from "../models/Offer.js";
import Candidate from "../models/Candidate.js";
import Recruiter from "../models/Recruiter.js";
import Notification from "../models/Notification.js";
import { mapRecruiterToCandidate } from "../utils/statusMapping.js";

export const getRecruiterInterviews = async (req, res) => {
  try {
    const recruiter = await Recruiter.findOne({ userId: req.user.id });
    const { status, upcoming, page = 1, limit = 20 } = req.query;

    let query = { recruiterId: recruiter._id };

    if (status) {
      query.status = status;
    }

    if (upcoming === "true") {
      query.scheduledAt = { $gte: new Date() };
      query.status = {
        $in: ["proposed", "confirmed", "rescheduled_by_candidate"],
      };
    }

    const skip = (page - 1) * limit;

    const [interviews, total] = await Promise.all([
      Interview.find(query)
        .sort({ scheduledAt: 1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate({
          path: "candidateId",
          select: "profilePicture userId",
          populate: { path: "userId", select: "nom email" },
        })
        .populate("offerId", "titre")
        .lean(),
      Interview.countDocuments(query),
    ]);

    const enriched = interviews.map((i) => ({
      ...i,
      needsAction: i.status === "rescheduled_by_candidate",
      isToday:
        new Date(i.scheduledAt).toDateString() === new Date().toDateString(),
      isPast: new Date(i.scheduledAt) < new Date(),
    }));

    res.json({
      data: enriched,
      meta: {
        total,
        page: parseInt(page),
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getRecruiterInterviewsGrouped = async (req, res) => {
  try {
    const recruiter = await Recruiter.findOne({ userId: req.user.id });
    const { view = "upcoming" } = req.query;

    const now = new Date();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    let query = { recruiterId: recruiter._id };

    if (view === "upcoming") {
      query.scheduledAt = { $gte: now };
      query.status = {
        $in: [
          "proposed",
          "confirmed",
          "rescheduled_by_candidate",
          "rescheduled_by_recruiter",
        ],
      };
    } else if (view === "recent") {
      query.scheduledAt = { $gte: sevenDaysAgo, $lt: now };
    }

    const interviews = await Interview.find(query)
      .sort({ scheduledAt: view === "upcoming" ? 1 : -1 })
      .populate({
        path: "candidateId",
        select: "profilePicture userId",
        populate: { path: "userId", select: "nom" },
      })
      .populate("offerId", "titre")
      .lean();

    const grouped = interviews.reduce((acc, interview) => {
      const dateKey = new Date(interview.scheduledAt)
        .toISOString()
        .split("T")[0];
      if (!acc[dateKey]) {
        acc[dateKey] = [];
      }
      acc[dateKey].push({
        _id: interview._id,
        type: interview.type,
        scheduledAt: interview.scheduledAt,
        duration: interview.duration,
        status: interview.status,
        location: interview.location,
        meetingLink: interview.meetingLink,
        candidate: {
          nom: interview.candidateId?.userId?.nom,
          profilePicture: interview.candidateId?.profilePicture,
        },
        offer: {
          _id: interview.offerId?._id,
          titre: interview.offerId?.titre,
        },
        needsAction: interview.status === "rescheduled_by_candidate",
      });
      return acc;
    }, {});

    res.json({
      grouped,
      total: interviews.length,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getCandidateInterviews = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    const { upcoming } = req.query;

    let query = { candidateId: candidate._id };

    if (upcoming === "true") {
      query.scheduledAt = { $gte: new Date() };
      query.status = {
        $nin: [
          "cancelled_by_candidate",
          "cancelled_by_recruiter",
          "completed",
          "no_show_candidate",
          "no_show_recruiter",
        ],
      };
    }

    const interviews = await Interview.find(query)
      .sort({ scheduledAt: 1 })
      .populate("offerId", "titre companyId")
      .populate({
        path: "offerId",
        populate: { path: "companyId", select: "name logo" },
      })
      .lean();

    const enriched = interviews.map((i) => ({
      _id: i._id,
      type: i.type,
      scheduledAt: i.scheduledAt,
      duration: i.duration,
      location: i.location,
      meetingLink: i.meetingLink,
      phoneNumber: i.phoneNumber,
      status: i.status,
      preparationNotes: i.preparationNotes,
      proposedAlternative: i.proposedAlternative,

      offerTitle: i.offerId?.titre,
      companyName: i.offerId?.companyId?.name,
      companyLogo: i.offerId?.companyId?.logo,

      needsResponse: ["proposed", "rescheduled_by_recruiter"].includes(
        i.status,
      ),
      isConfirmed: i.status === "confirmed",
      isPendingRecruiter: i.status === "rescheduled_by_candidate",
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// ====================================================================
// FIX #12: New endpoint — Get interview details by ID (for candidate)
// ====================================================================
export const getCandidateInterviewById = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    if (!candidate) {
      return res.status(404).json({ msg: "Profil candidat introuvable" });
    }

    const { interviewId } = req.params;

    const interview = await Interview.findOne({
      _id: interviewId,
      candidateId: candidate._id,
    })
      .populate("offerId", "titre companyId type wilaya")
      .populate({
        path: "offerId",
        populate: { path: "companyId", select: "name logo location" },
      })
      .lean();

    if (!interview) {
      return res.status(404).json({ msg: "Entretien introuvable" });
    }

    res.json({
      _id: interview._id,
      interviewNumber: interview.interviewNumber,
      type: interview.type,
      scheduledAt: interview.scheduledAt,
      duration: interview.duration,
      location: interview.location,
      meetingLink: interview.meetingLink,
      phoneNumber: interview.phoneNumber,
      schedulingMode: interview.schedulingMode,
      proposedSlots: interview.proposedSlots,
      chosenSlot: interview.chosenSlot,
      preparationNotes: interview.preparationNotes,
      status: interview.status,
      proposedAlternative: interview.proposedAlternative,
      declineReason: interview.declineReason,
      cancellationReason: interview.cancellationReason,
      cancelledBy: interview.cancelledBy,

      offer: {
        _id: interview.offerId?._id,
        titre: interview.offerId?.titre,
        type: interview.offerId?.type,
        wilaya: interview.offerId?.wilaya,
        company: {
          name: interview.offerId?.companyId?.name,
          logo: interview.offerId?.companyId?.logo,
          location: interview.offerId?.companyId?.location,
        },
      },

      needsResponse: ["proposed", "rescheduled_by_recruiter"].includes(
        interview.status,
      ),
      canAccept: ["proposed", "rescheduled_by_recruiter"].includes(
        interview.status,
      ),
      canCounter: ["proposed", "rescheduled_by_recruiter"].includes(
        interview.status,
      ),
      canCancel: ["proposed", "confirmed", "rescheduled_by_recruiter"].includes(
        interview.status,
      ),

      createdAt: interview.createdAt,
      updatedAt: interview.updatedAt,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// FIX #12: New endpoint — Get interview details by ID (for recruiter)
export const getRecruiterInterviewById = async (req, res) => {
  try {
    const recruiter = await Recruiter.findOne({ userId: req.user.id });
    if (!recruiter) {
      return res.status(404).json({ msg: "Profil recruteur introuvable" });
    }

    const { interviewId } = req.params;

    const interview = await Interview.findOne({
      _id: interviewId,
      recruiterId: recruiter._id,
    })
      .populate({
        path: "candidateId",
        select: "profilePicture userId telephone",
        populate: { path: "userId", select: "nom email" },
      })
      .populate("offerId", "titre companyId type")
      .lean();

    if (!interview) {
      return res.status(404).json({ msg: "Entretien introuvable" });
    }

    res.json({
      _id: interview._id,
      interviewNumber: interview.interviewNumber,
      type: interview.type,
      scheduledAt: interview.scheduledAt,
      duration: interview.duration,
      location: interview.location,
      meetingLink: interview.meetingLink,
      phoneNumber: interview.phoneNumber,
      schedulingMode: interview.schedulingMode,
      proposedSlots: interview.proposedSlots,
      chosenSlot: interview.chosenSlot,
      preparationNotes: interview.preparationNotes,
      status: interview.status,
      proposedAlternative: interview.proposedAlternative,
      cancellationReason: interview.cancellationReason,
      cancelledBy: interview.cancelledBy,
      declineReason: interview.declineReason,
      recruiterNotes: interview.recruiterNotes,

      // Feedback (only for recruiter)
      feedback: interview.feedback,

      candidate: {
        _id: interview.candidateId?._id,
        nom: interview.candidateId?.userId?.nom,
        email: interview.candidateId?.userId?.email,
        profilePicture: interview.candidateId?.profilePicture,
        telephone: interview.candidateId?.telephone,
      },

      offer: {
        _id: interview.offerId?._id,
        titre: interview.offerId?.titre,
        type: interview.offerId?.type,
      },

      needsAction: interview.status === "rescheduled_by_candidate",
      isFeedbackDue:
        interview.status === "pending_feedback" ||
        (interview.status === "confirmed" &&
          interview.scheduledAt &&
          new Date(interview.scheduledAt) < new Date()),
      isToday:
        interview.scheduledAt &&
        new Date(interview.scheduledAt).toDateString() ===
          new Date().toDateString(),
      isPast:
        interview.scheduledAt && new Date(interview.scheduledAt) < new Date(),

      applicationId: interview.applicationId,
      conversationId: interview.conversationId,

      createdAt: interview.createdAt,
      updatedAt: interview.updatedAt,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};
