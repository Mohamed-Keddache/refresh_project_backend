import Skill from "../models/Skills.js";
import ProposedSkill from "../models/ProposedSkill.js";
import Candidate from "../models/Candidate.js";
import SystemSettings from "../models/SystemSettings.js";

/**
 * Get skills with search
 * GET /api/skills
 */
export const getSkills = async (req, res) => {
  try {
    const { search, category } = req.query;
    let query = {};

    if (search) {
      query.name = { $regex: search, $options: "i" };
    }

    if (category) {
      query.category = category;
    }

    const skills = await Skill.find(query).sort({ name: 1 }).limit(50).lean();

    // Get distinct categories for filtering
    const categories = await Skill.distinct("category");

    res.json({
      skills,
      categories: categories.filter(Boolean),
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Check if skill proposal is enabled
 * GET /api/skills/proposal-status
 */
export const getSkillProposalStatus = async (req, res) => {
  try {
    const enabled = await SystemSettings.getSetting(
      "skill_proposal_enabled",
      true,
    );
    res.json({ enabled });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Create skill (admin only)
 * POST /api/admin/skills
 */
export const createSkill = async (req, res) => {
  try {
    const { name, category } = req.body;
    const normalizedName = name.trim().toLowerCase();

    const exist = await Skill.findOne({ name: normalizedName });
    if (exist) {
      return res.status(400).json({ msg: "Cette compétence existe déjà." });
    }

    const newSkill = await Skill.create({
      name: normalizedName,
      category: category?.trim() || null,
    });

    res.status(201).json(newSkill);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Delete skill (admin only)
 * DELETE /api/admin/skills/:id
 */
export const deleteSkill = async (req, res) => {
  try {
    const skill = await Skill.findByIdAndDelete(req.params.id);
    if (!skill) {
      return res.status(404).json({ msg: "Compétence introuvable" });
    }
    res.json({ msg: "Compétence supprimée" });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Get all proposed skills (admin only)
 * GET /api/admin/skills/proposed
 */
export const getProposedSkills = async (req, res) => {
  try {
    const { status = "pending", page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    let query = {};
    if (status !== "all") {
      query.status = status;
    }

    const [proposedSkills, total] = await Promise.all([
      ProposedSkill.find(query)
        .sort({ proposalCount: -1, createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate("proposedBy.userId", "nom email")
        .populate("reviewedBy", "nom")
        .lean(),
      ProposedSkill.countDocuments(query),
    ]);

    res.json({
      data: proposedSkills,
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

/**
 * Approve proposed skill and add to official list (admin only)
 * POST /api/admin/skills/proposed/:id/approve
 */
export const approveProposedSkill = async (req, res) => {
  try {
    const { id } = req.params;
    const { domain } = req.body;

    const proposedSkill = await ProposedSkill.findById(id);
    if (!proposedSkill) {
      return res.status(404).json({ msg: "Compétence proposée introuvable" });
    }

    if (proposedSkill.status !== "pending") {
      return res
        .status(400)
        .json({ msg: "Cette compétence a déjà été traitée" });
    }

    // Check if skill already exists in official list
    let officialSkill = await Skill.findOne({ name: proposedSkill.label });

    if (!officialSkill) {
      // Create official skill
      officialSkill = await Skill.create({
        name: proposedSkill.label,
        category: domain?.trim() || null,
        wasProposed: true,
        proposedSkillId: proposedSkill._id,
      });
    }

    // Update proposed skill status
    proposedSkill.status = "approved";
    proposedSkill.domain = domain?.trim() || null;
    proposedSkill.approvedSkillId = officialSkill._id;
    proposedSkill.reviewedBy = req.user.id;
    proposedSkill.reviewedAt = new Date();
    await proposedSkill.save();

    // Update all candidate profiles that have this skill with null domain
    const updateResult = await Candidate.updateMany(
      {
        "skills.name": proposedSkill.label,
        "skills.domain": null,
      },
      {
        $set: {
          "skills.$[elem].domain": domain?.trim() || null,
          "skills.$[elem].skillId": officialSkill._id,
          "skills.$[elem].isProposed": false,
        },
      },
      {
        arrayFilters: [
          { "elem.name": proposedSkill.label, "elem.domain": null },
        ],
      },
    );

    res.json({
      msg: "Compétence approuvée et ajoutée à la liste officielle",
      skill: officialSkill,
      candidatesUpdated: updateResult.modifiedCount,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Reject proposed skill (admin only)
 * POST /api/admin/skills/proposed/:id/reject
 */
export const rejectProposedSkill = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const proposedSkill = await ProposedSkill.findById(id);
    if (!proposedSkill) {
      return res.status(404).json({ msg: "Compétence proposée introuvable" });
    }

    proposedSkill.status = "rejected";
    proposedSkill.reviewedBy = req.user.id;
    proposedSkill.reviewedAt = new Date();
    proposedSkill.reviewNote = reason;
    await proposedSkill.save();

    res.json({ msg: "Compétence proposée rejetée", proposedSkill });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * Get proposed skills stats (admin only)
 * GET /api/admin/skills/proposed/stats
 */
export const getProposedSkillsStats = async (req, res) => {
  try {
    const stats = await ProposedSkill.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const statsMap = {
      pending: 0,
      approved: 0,
      rejected: 0,
      merged: 0,
    };

    stats.forEach((s) => {
      statsMap[s._id] = s.count;
    });

    const mostProposed = await ProposedSkill.find({ status: "pending" })
      .sort({ proposalCount: -1 })
      .limit(5)
      .select("label proposalCount");

    res.json({
      byStatus: statsMap,
      total: Object.values(statsMap).reduce((a, b) => a + b, 0),
      mostProposed,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export default {
  getSkills,
  getSkillProposalStatus,
  createSkill,
  deleteSkill,
  getProposedSkills,
  approveProposedSkill,
  rejectProposedSkill,
  getProposedSkillsStats,
};
