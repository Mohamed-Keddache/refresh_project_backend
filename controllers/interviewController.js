// controllers/interviewController.js
import Interview from "../models/Interview.js";
import Application from "../models/Application.js";
import Offer from "../models/Offer.js";
import Candidate from "../models/Candidate.js";
import Recruiter from "../models/Recruiter.js";
import Notification from "../models/Notification.js";
import { mapRecruiterToCandidate } from "../utils/statusMapping.js";

// === RECRUTEUR ===

// Proposer un entretien
export const proposeInterview = async (req, res) => {
  try {
    const recruiter = await Recruiter.findOne({ userId: req.user.id });
    const { applicationId } = req.params;
    const {
      type,
      scheduledAt,
      duration,
      location,
      meetingLink,
      phoneNumber,
      preparationNotes,
    } = req.body;

    const application =
      await Application.findById(applicationId).populate("offerId");

    if (!application) {
      return res.status(404).json({ msg: "Candidature introuvable" });
    }

    if (
      application.offerId.recruteurId.toString() !== recruiter._id.toString()
    ) {
      return res.status(403).json({ msg: "Non autorisé" });
    }

    // Vérifier que le statut permet un entretien
    const allowedStatuses = [
      "consultee",
      "preselection",
      "en_discussion",
      "entretien_termine",
    ];
    if (!allowedStatuses.includes(application.recruiterStatus)) {
      return res.status(400).json({
        msg: "Cette candidature ne peut pas recevoir d'entretien dans son état actuel",
      });
    }

    const interview = await Interview.create({
      applicationId,
      offerId: application.offerId._id,
      candidateId: application.candidateId,
      recruiterId: recruiter._id,
      type,
      scheduledAt: new Date(scheduledAt),
      duration: duration || 30,
      location,
      meetingLink,
      phoneNumber,
      preparationNotes,
      status: "proposed",
    });

    // Mettre à jour le statut de l'application
    if (application.recruiterStatus !== "entretien_planifie") {
      application.recruiterStatus = "entretien_planifie";
      application.candidateStatus =
        mapRecruiterToCandidate("entretien_planifie");
      application.statusHistory.push({
        candidateStatus: application.candidateStatus,
        recruiterStatus: "entretien_planifie",
        changedBy: req.user.id,
        note: "Entretien proposé",
      });
      await application.save();
    }

    // Notifier le candidat
    const candidate = await Candidate.findById(application.candidateId);
    await Notification.create({
      userId: candidate.userId,
      message: `Un entretien vous est proposé pour "${
        application.offerId.titre
      }" le ${new Date(scheduledAt).toLocaleDateString("fr-FR")}`,
      type: "validation",
    });

    res.status(201).json({ msg: "Entretien proposé", interview });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// Liste des entretiens du recruteur
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

    // Ajouter indicateurs
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
    const { view = "upcoming" } = req.query; // 'upcoming', 'recent', 'all'

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

    // Grouper par date pour l'affichage
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

// Accepter la proposition alternative du candidat
export const acceptAlternativeDate = async (req, res) => {
  try {
    const recruiter = await Recruiter.findOne({ userId: req.user.id });
    const { interviewId } = req.params;

    const interview = await Interview.findOne({
      _id: interviewId,
      recruiterId: recruiter._id,
      status: "rescheduled_by_candidate",
    });

    if (!interview) {
      return res
        .status(404)
        .json({ msg: "Entretien introuvable ou pas de proposition" });
    }

    interview.scheduledAt = interview.proposedAlternative.date;
    interview.status = "confirmed";
    interview.proposedAlternative = undefined;
    await interview.save();

    // Notifier
    const candidate = await Candidate.findById(interview.candidateId);
    await Notification.create({
      userId: candidate.userId,
      message: `Votre nouvelle date d'entretien a été confirmée`,
      type: "validation",
    });

    res.json({ msg: "Nouvelle date acceptée", interview });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// Proposer une autre date (recruteur)
export const rescheduleByRecruiter = async (req, res) => {
  try {
    const recruiter = await Recruiter.findOne({ userId: req.user.id });
    const { interviewId } = req.params;
    const { newDate, message } = req.body;

    const interview = await Interview.findOne({
      _id: interviewId,
      recruiterId: recruiter._id,
    });

    if (!interview) {
      return res.status(404).json({ msg: "Entretien introuvable" });
    }

    interview.scheduledAt = new Date(newDate);
    interview.status = "rescheduled_by_recruiter";
    interview.proposedAlternative = {
      date: new Date(newDate),
      proposedBy: "recruiter",
      message,
      proposedAt: new Date(),
    };
    await interview.save();

    const candidate = await Candidate.findById(interview.candidateId);
    await Notification.create({
      userId: candidate.userId,
      message: `L'entretien a été reprogrammé, veuillez confirmer la nouvelle date`,
      type: "validation",
    });

    res.json({ msg: "Entretien reprogrammé", interview });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// Annuler entretien (recruteur)
export const cancelInterviewByRecruiter = async (req, res) => {
  try {
    const recruiter = await Recruiter.findOne({ userId: req.user.id });
    const { interviewId } = req.params;
    const { reason } = req.body;

    const interview = await Interview.findOneAndUpdate(
      {
        _id: interviewId,
        recruiterId: recruiter._id,
        status: {
          $in: [
            "proposed",
            "confirmed",
            "rescheduled_by_candidate",
            "rescheduled_by_recruiter",
          ],
        },
      },
      {
        status: "cancelled_by_recruiter",
        recruiterNotes: reason,
      },
      { new: true },
    );

    if (!interview) {
      return res
        .status(404)
        .json({ msg: "Entretien introuvable ou déjà terminé" });
    }

    const candidate = await Candidate.findById(interview.candidateId);
    await Notification.create({
      userId: candidate.userId,
      message: `L'entretien prévu a été annulé par le recruteur`,
      type: "info",
    });

    res.json({ msg: "Entretien annulé", interview });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// Marquer comme terminé + feedback
export const completeInterview = async (req, res) => {
  try {
    const recruiter = await Recruiter.findOne({ userId: req.user.id });
    const { interviewId } = req.params;

    const { rating, notes, strengths, concerns, recommendation, status } =
      req.body;

    const interview = await Interview.findOne({
      _id: interviewId,
      recruiterId: recruiter._id,
    });

    if (!interview) {
      return res.status(404).json({ msg: "Entretien introuvable" });
    }

    interview.status = "completed";
    interview.feedback = {
      rating,
      notes,
      strengths,
      concerns,
      recommendation,
      completedAt: new Date(),
    };

    await interview.save();

    if (status === "retenue" || status === "refusee") {
      const application = await Application.findById(interview.applicationId);

      application.recruiterStatus = status;

      if (status === "retenue") {
        application.candidateStatus = "retenue";
        application.dateDecision = new Date();
      } else {
        application.candidateStatus = "non_retenue";
        application.dateDecision = new Date();
      }

      application.statusHistory.push({
        candidateStatus: application.candidateStatus,
        recruiterStatus: status,
        changedBy: req.user.id,
        note: `Décision finale après entretien: ${recommendation}`,
      });

      await application.save();
    } else {
      const pendingInterviews = await Interview.countDocuments({
        applicationId: interview.applicationId,
        status: { $in: ["proposed", "confirmed"] },
      });

      if (pendingInterviews === 0) {
        const application = await Application.findById(interview.applicationId);

        if (
          application.recruiterStatus !== "retenue" &&
          application.recruiterStatus !== "refusee"
        ) {
          application.recruiterStatus = "entretien_termine";
          application.candidateStatus =
            mapRecruiterToCandidate("entretien_termine");

          application.statusHistory.push({
            candidateStatus: application.candidateStatus,
            recruiterStatus: "entretien_termine",
            changedBy: req.user.id,
            note: "Tous les entretiens terminés",
          });

          await application.save();
        }
      }
    }

    res.json({
      msg: "Entretien terminé et décision enregistrée",
      interview,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// === CANDIDAT ===

// Mes entretiens
export const getCandidateInterviews = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    const { upcoming } = req.query;

    let query = { candidateId: candidate._id };

    if (upcoming === "true") {
      query.scheduledAt = { $gte: new Date() };
      // Don't show cancelled ones in the "Upcoming" tab
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

      // Context info
      offerTitle: i.offerId?.titre,
      companyName: i.offerId?.companyId?.name,
      companyLogo: i.offerId?.companyId?.logo,

      // Logic helpers for Frontend
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

// Accepter entretien
export const acceptInterview = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    const { interviewId } = req.params;

    const interview = await Interview.findOneAndUpdate(
      {
        _id: interviewId,
        candidateId: candidate._id,
        status: { $in: ["proposed", "rescheduled_by_recruiter"] },
      },
      { status: "confirmed" },
      { new: true },
    );

    if (!interview) {
      return res
        .status(404)
        .json({ msg: "Entretien introuvable ou déjà traité" });
    }

    // Notifier recruteur
    const recruiter = await Recruiter.findById(interview.recruiterId);
    await Notification.create({
      userId: recruiter.userId,
      message: `Le candidat a confirmé l'entretien`,
      type: "validation",
    });

    res.json({ msg: "Entretien confirmé", interview });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// Refuser entretien
export const declineInterview = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    const { interviewId } = req.params;
    const { reason } = req.body;

    const interview = await Interview.findOneAndUpdate(
      {
        _id: interviewId,
        candidateId: candidate._id,
        status: { $in: ["proposed", "rescheduled_by_recruiter"] },
      },
      { status: "cancelled_by_candidate" },
      { new: true },
    );

    if (!interview) {
      return res.status(404).json({ msg: "Entretien introuvable" });
    }

    const recruiter = await Recruiter.findById(interview.recruiterId);
    await Notification.create({
      userId: recruiter.userId,
      message: `Le candidat a décliné l'entretien${
        reason ? `: ${reason}` : ""
      }`,
      type: "info",
    });

    res.json({ msg: "Entretien décliné", interview });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// Proposer nouvelle date (candidat)
export const proposeAlternativeDate = async (req, res) => {
  try {
    const candidate = await Candidate.findOne({ userId: req.user.id });
    const { interviewId } = req.params;
    const { newDate, message } = req.body;

    const interview = await Interview.findOne({
      _id: interviewId,
      candidateId: candidate._id,
      status: { $in: ["proposed", "rescheduled_by_recruiter"] },
    });

    if (!interview) {
      return res.status(404).json({ msg: "Entretien introuvable" });
    }

    interview.status = "rescheduled_by_candidate";
    interview.proposedAlternative = {
      date: new Date(newDate),
      proposedBy: "candidate",
      message,
      proposedAt: new Date(),
    };
    await interview.save();

    const recruiter = await Recruiter.findById(interview.recruiterId);
    await Notification.create({
      userId: recruiter.userId,
      message: `Le candidat propose une nouvelle date pour l'entretien`,
      type: "validation",
    });

    res.json({ msg: "Proposition envoyée", interview });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};
