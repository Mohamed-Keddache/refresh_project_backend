// controllers/skillController.js
import Skill from "../models/Skills.js";
import SkillCluster from "../models/SkillCluster.js";
import SkillFeedback from "../models/SkillFeedback.js";
import ProposedSkill from "../models/ProposedSkill.js";
import Candidate from "../models/Candidate.js";
import User from "../models/User.js";
import SystemSettings from "../models/SystemSettings.js";
import { logAdminAction } from "../models/AdminLog.js";

// ─── Abuse detection helpers ───

const ABUSE_PATTERNS = [
  /\b(ceo of|king of|lord of|god of|master of)\b/i,
  /\b(fuck|shit|ass|porn|xxx|dick|pussy|bitch)\b/i,
  /(.)\1{4,}/i, // repeated chars like "aaaaaa"
  /^.{0,1}$/i, // single char
  /^.{100,}$/i, // absurdly long
];

const detectAbuse = (text) => {
  for (const pattern of ABUSE_PATTERNS) {
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
};

// ─── Similarity helpers ───

const levenshtein = (a, b) => {
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) =>
      i === 0 ? j : j === 0 ? i : 0,
    ),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[a.length][b.length];
};

const similarity = (a, b) => {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
};

const findBestMatch = async (rawText, threshold = 0.6) => {
  const normalized = rawText.trim().toLowerCase();

  // 1. Exact match on official skill name
  const exactMatch = await Skill.findOne({
    name: normalized,
    isHidden: { $ne: true },
  });
  if (exactMatch) {
    return { match: exactMatch, type: "exact", confidence: 1.0 };
  }

  // 2. Exact match on alias
  const aliasMatch = await Skill.findOne({
    aliases: normalized,
    isHidden: { $ne: true },
  });
  if (aliasMatch) {
    return { match: aliasMatch, type: "alias", confidence: 0.95 };
  }

  // 3. Fuzzy search — get candidates via regex prefix then score
  const prefix = normalized.substring(
    0,
    Math.max(2, Math.floor(normalized.length * 0.5)),
  );
  const candidates = await Skill.find({
    $or: [
      { name: { $regex: prefix, $options: "i" } },
      { aliases: { $regex: prefix, $options: "i" } },
    ],
    isHidden: { $ne: true },
  })
    .limit(50)
    .lean();

  let bestScore = 0;
  let bestCandidate = null;

  for (const skill of candidates) {
    const nameScore = similarity(normalized, skill.name);
    let maxAliasScore = 0;
    for (const alias of skill.aliases || []) {
      const aliasScore = similarity(normalized, alias);
      if (aliasScore > maxAliasScore) maxAliasScore = aliasScore;
    }
    const score = Math.max(nameScore, maxAliasScore);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = skill;
    }
  }

  if (bestScore >= threshold && bestCandidate) {
    return {
      match: bestCandidate,
      type: bestScore >= 0.9 ? "alias" : "fuzzy",
      confidence: bestScore,
    };
  }

  return { match: null, type: "unmatched", confidence: 0 };
};

// ════════════════════════════════════════════
//  PUBLIC / CANDIDATE ENDPOINTS
// ════════════════════════════════════════════

/**
 * GET /api/skills/
 * Search official skills (for suggestions while typing)
 */
export const getSkills = async (req, res) => {
  try {
    const { search, category } = req.query;

    const suggestionsEnabled = await SystemSettings.getSetting(
      "skill_suggestions_enabled",
      true,
    );

    if (!suggestionsEnabled && search) {
      return res.json({ skills: [], categories: [] });
    }

    let query = { isHidden: { $ne: true } };

    if (search) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.$or = [
        { name: { $regex: escaped, $options: "i" } },
        { aliases: { $regex: escaped, $options: "i" } },
      ];
    }

    if (category) {
      query.category = category;
    }

    const skills = await Skill.find(query)
      .sort({ usageCount: -1, name: 1 })
      .limit(50)
      .select("name category subCategory aliases usageCount")
      .lean();

    const categories = await Skill.distinct("category", {
      isHidden: { $ne: true },
    });

    res.json({
      skills,
      categories: categories.filter(Boolean),
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * GET /api/skills/proposal-status
 */
export const getSkillProposalStatus = async (req, res) => {
  try {
    const settings = await SystemSettings.getMultipleSettings([
      "skill_proposal_enabled",
      "skill_system_enabled",
      "max_skills_per_candidate",
      "skill_level_enabled",
      "skill_suggestions_enabled",
      "skill_feedback_enabled",
    ]);

    res.json({
      systemEnabled: settings.skill_system_enabled ?? true,
      proposalEnabled: settings.skill_proposal_enabled ?? true,
      maxSkills: settings.max_skills_per_candidate ?? 6,
      levelEnabled: settings.skill_level_enabled ?? true,
      suggestionsEnabled: settings.skill_suggestions_enabled ?? true,
      feedbackEnabled: settings.skill_feedback_enabled ?? true,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * GET /api/skills/suggest?q=reac
 * Real-time suggestion endpoint for typing
 */
export const suggestSkills = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length < 2) {
      return res.json({ suggestions: [] });
    }

    const suggestionsEnabled = await SystemSettings.getSetting(
      "skill_suggestions_enabled",
      true,
    );

    if (!suggestionsEnabled) {
      return res.json({ suggestions: [] });
    }

    const threshold = await SystemSettings.getSetting(
      "skill_suggestion_threshold",
      0.6,
    );

    const normalized = q.trim().toLowerCase();
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Prefix/contains matches from official skills
    const officialMatches = await Skill.find({
      $or: [
        { name: { $regex: escaped, $options: "i" } },
        { aliases: { $regex: escaped, $options: "i" } },
      ],
      isHidden: { $ne: true },
    })
      .sort({ usageCount: -1 })
      .limit(10)
      .select("name category usageCount")
      .lean();

    // Score and categorize
    const suggestions = officialMatches.map((skill) => {
      const score = similarity(normalized, skill.name);
      let matchLevel = "close";
      if (score >= 0.9) matchLevel = "strong";
      if (score < threshold) matchLevel = "weak";

      return {
        _id: skill._id,
        name: skill.name,
        category: skill.category,
        confidence: Math.round(score * 100) / 100,
        matchLevel,
      };
    });

    // Filter out weak matches
    const filtered = suggestions.filter((s) => s.confidence >= threshold);

    // Sort: strong first, then by confidence
    filtered.sort((a, b) => b.confidence - a.confidence);

    res.json({
      suggestions: filtered.slice(0, 5),
      query: q.trim(),
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * POST /api/candidates/profil/skills (called from candidateController)
 * Add a skill — the core of the candidate flow
 */
export const addSkillToCandidate = async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, level, selectedSuggestionId } = req.body;

    if (!name || name.trim().length === 0) {
      return res
        .status(400)
        .json({ msg: "Le nom de la compétence est requis." });
    }

    const systemEnabled = await SystemSettings.getSetting(
      "skill_system_enabled",
      true,
    );
    if (!systemEnabled) {
      return res
        .status(400)
        .json({ msg: "Le système de compétences est actuellement désactivé." });
    }

    const candidate = await Candidate.findOne({ userId });
    if (!candidate) {
      return res.status(404).json({ msg: "Profil introuvable." });
    }

    const maxSkills = await SystemSettings.getSetting(
      "max_skills_per_candidate",
      6,
    );
    if (candidate.skills.length >= maxSkills) {
      return res.status(400).json({
        msg: `Vous ne pouvez pas ajouter plus de ${maxSkills} compétences.`,
        maxSkills,
      });
    }

    const rawText = name.trim();
    const normalizedText = rawText.toLowerCase();

    // Check duplicate
    const existingSkill = candidate.skills.find(
      (s) => s.normalizedText === normalizedText,
    );
    if (existingSkill) {
      return res.status(400).json({ msg: "Vous avez déjà cette compétence." });
    }

    // Abuse detection
    const abuseEnabled = await SystemSettings.getSetting(
      "skill_abuse_detection_enabled",
      true,
    );
    const isAbusive = abuseEnabled && detectAbuse(rawText);

    // Build the skill entry
    const skillEntry = {
      rawText,
      normalizedText,
      level: level || "unset",
      addedAt: new Date(),
      isVisibleToRecruiters: !isAbusive,
      isFlagged: isAbusive,
      flagReason: isAbusive ? "auto_detected_abuse" : undefined,
    };

    // If user explicitly selected a suggestion
    if (selectedSuggestionId) {
      const officialSkill = await Skill.findById(selectedSuggestionId);
      if (officialSkill && !officialSkill.isHidden) {
        skillEntry.officialSkillId = officialSkill._id;
        skillEntry.officialSkillName = officialSkill.name;
        skillEntry.domain = officialSkill.category;
        skillEntry.subDomain = officialSkill.subCategory;
        skillEntry.matchType = "exact";

        // Increment usage
        await Skill.findByIdAndUpdate(officialSkill._id, {
          $inc: { usageCount: 1 },
        });
      }
    } else if (!isAbusive) {
      // Attempt background matching
      const proposalEnabled = await SystemSettings.getSetting(
        "skill_proposal_enabled",
        true,
      );

      const threshold = await SystemSettings.getSetting(
        "skill_suggestion_threshold",
        0.6,
      );

      const matchResult = await findBestMatch(normalizedText, threshold);

      if (matchResult.match && matchResult.confidence >= 0.9) {
        // Strong match — auto-map silently
        skillEntry.officialSkillId = matchResult.match._id;
        skillEntry.officialSkillName = matchResult.match.name;
        skillEntry.domain = matchResult.match.category;
        skillEntry.subDomain = matchResult.match.subCategory;
        skillEntry.matchType = matchResult.type === "exact" ? "exact" : "alias";

        await Skill.findByIdAndUpdate(matchResult.match._id, {
          $inc: { usageCount: 1 },
        });
      } else {
        // Unmatched — track in cluster for admin review
        skillEntry.matchType = "unmatched";

        if (!proposalEnabled) {
          return res.status(400).json({
            msg: "Cette compétence n'existe pas dans notre liste. Veuillez en sélectionner une parmi les suggestions.",
          });
        }
      }
    }

    // Track in cluster system (async, non-blocking for user)
    if (!isAbusive) {
      try {
        const { cluster } = await SkillCluster.trackVariant(normalizedText);
        skillEntry.clusterId = cluster._id;
      } catch (clusterErr) {
        console.error("Cluster tracking error (non-blocking):", clusterErr);
      }
    } else {
      // Flag cluster
      try {
        const { cluster } = await SkillCluster.trackVariant(normalizedText);
        skillEntry.clusterId = cluster._id;
        cluster.isFlagged = true;
        cluster.flagCount = (cluster.flagCount || 0) + 1;
        cluster.flagReasons.push({
          reason: "auto_abuse_detection",
          flaggedBy: "system",
          flaggedAt: new Date(),
        });
        await cluster.save();
      } catch (clusterErr) {
        console.error("Cluster flagging error (non-blocking):", clusterErr);
      }
    }

    candidate.skills.push(skillEntry);
    await candidate.save();

    const addedSkill = candidate.skills[candidate.skills.length - 1];

    res.json({
      msg: "Compétence ajoutée",
      skill: {
        _id: addedSkill._id,
        rawText: addedSkill.rawText,
        level: addedSkill.level,
        officialSkillName: addedSkill.officialSkillName,
        domain: addedSkill.domain,
        subDomain: addedSkill.subDomain,
        matchType: addedSkill.matchType,
      },
      totalSkills: candidate.skills.length,
      maxSkills,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * PUT /api/candidates/profil/skills/:skillId
 * Update skill level
 */
export const updateCandidateSkill = async (req, res) => {
  try {
    const userId = req.user.id;
    const { skillId } = req.params;
    const { level } = req.body;

    const levelEnabled = await SystemSettings.getSetting(
      "skill_level_enabled",
      true,
    );

    const candidate = await Candidate.findOne({ userId });
    if (!candidate) {
      return res.status(404).json({ msg: "Profil introuvable." });
    }

    const skill = candidate.skills.id(skillId);
    if (!skill) {
      return res.status(404).json({ msg: "Compétence introuvable." });
    }

    if (level && levelEnabled) {
      const validLevels = ["beginner", "intermediate", "expert", "unset"];
      if (!validLevels.includes(level)) {
        return res.status(400).json({ msg: "Niveau invalide." });
      }
      skill.level = level;
    } else if (level && !levelEnabled) {
      return res.status(400).json({
        msg: "La définition du niveau de compétence est actuellement désactivée.",
      });
    }

    await candidate.save();
    res.json({ msg: "Compétence mise à jour", skill });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * DELETE /api/candidates/profil/skills/:skillId
 */
export const deleteCandidateSkill = async (req, res) => {
  try {
    const userId = req.user.id;
    const { skillId } = req.params;

    const candidate = await Candidate.findOne({ userId });
    if (!candidate) {
      return res.status(404).json({ msg: "Profil introuvable." });
    }

    const skill = candidate.skills.id(skillId);
    if (!skill) {
      return res.status(404).json({ msg: "Compétence introuvable." });
    }

    // Decrement usage if mapped
    if (skill.officialSkillId) {
      await Skill.findByIdAndUpdate(skill.officialSkillId, {
        $inc: { usageCount: -1 },
      });
    }

    candidate.skills.pull(skillId);
    await candidate.save();

    res.json({ msg: "Compétence supprimée", skills: candidate.skills });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * GET /api/candidates/profil/skills/:skillId/details
 * Expanded view of a skill — shows official mapping, domain, etc.
 */
export const getSkillDetails = async (req, res) => {
  try {
    const userId = req.user.id;
    const { skillId } = req.params;

    const candidate = await Candidate.findOne({ userId });
    if (!candidate) {
      return res.status(404).json({ msg: "Profil introuvable." });
    }

    const skill = candidate.skills.id(skillId);
    if (!skill) {
      return res.status(404).json({ msg: "Compétence introuvable." });
    }

    const feedbackEnabled = await SystemSettings.getSetting(
      "skill_feedback_enabled",
      true,
    );

    let canSubmitFeedback = false;
    if (feedbackEnabled && skill.officialSkillId) {
      const maxPerSkill = await SystemSettings.getSetting(
        "skill_feedback_max_per_skill",
        1,
      );
      const activeFeedback = await SkillFeedback.countDocuments({
        candidateSkillId: skill._id,
        userId,
        status: "pending",
      });
      canSubmitFeedback = activeFeedback < maxPerSkill;
    }

    res.json({
      _id: skill._id,
      rawText: skill.rawText,
      level: skill.level,
      officialSkillName: skill.officialSkillName,
      domain: skill.domain,
      subDomain: skill.subDomain,
      matchType: skill.matchType,
      addedAt: skill.addedAt,
      mappingHistory: skill.mappingHistory,
      canSubmitFeedback,
      feedbackEnabled,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * POST /api/candidates/profil/skills/:skillId/feedback
 * Report incorrect mapping
 */
export const submitSkillFeedback = async (req, res) => {
  try {
    const userId = req.user.id;
    const { skillId } = req.params;
    const { category, comment } = req.body;

    const feedbackEnabled = await SystemSettings.getSetting(
      "skill_feedback_enabled",
      true,
    );
    if (!feedbackEnabled) {
      return res.status(400).json({
        msg: "Le système de feedback de compétences est actuellement désactivé.",
      });
    }

    const candidate = await Candidate.findOne({ userId });
    if (!candidate) {
      return res.status(404).json({ msg: "Profil introuvable." });
    }

    const skill = candidate.skills.id(skillId);
    if (!skill) {
      return res.status(404).json({ msg: "Compétence introuvable." });
    }

    if (!skill.officialSkillId) {
      return res.status(400).json({
        msg: "Aucun mapping officiel à signaler pour cette compétence.",
      });
    }

    // Check weekly limit
    const maxPerWeek = await SystemSettings.getSetting(
      "skill_feedback_max_per_week",
      3,
    );
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const weeklyCount = await SkillFeedback.countDocuments({
      userId,
      createdAt: { $gte: oneWeekAgo },
    });
    if (weeklyCount >= maxPerWeek) {
      return res.status(429).json({
        msg: `Vous avez atteint la limite de ${maxPerWeek} feedback(s) par semaine.`,
      });
    }

    // Check per-skill limit
    const maxPerSkill = await SystemSettings.getSetting(
      "skill_feedback_max_per_skill",
      1,
    );
    const skillCount = await SkillFeedback.countDocuments({
      candidateSkillId: skill._id,
      userId,
      status: "pending",
    });
    if (skillCount >= maxPerSkill) {
      return res.status(400).json({
        msg: "Vous avez déjà un feedback en attente pour cette compétence.",
      });
    }

    const validCategories = [
      "incorrect_mapping",
      "wrong_domain",
      "skill_merged_incorrectly",
      "other",
    ];
    if (!category || !validCategories.includes(category)) {
      return res.status(400).json({ msg: "Catégorie de feedback invalide." });
    }

    const feedback = await SkillFeedback.create({
      userId,
      candidateId: candidate._id,
      candidateSkillId: skill._id,
      rawSkillText: skill.rawText,
      mappedToSkillId: skill.officialSkillId,
      mappedToName: skill.officialSkillName,
      category,
      comment: comment?.substring(0, 500),
    });

    res.json({
      msg: "Feedback soumis. Merci pour votre contribution.",
      feedbackId: feedback._id,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// ════════════════════════════════════════════
//  ADMIN ENDPOINTS
// ════════════════════════════════════════════

/**
 * POST /api/admin/skills
 * Create a new official skill
 */
export const createSkill = async (req, res) => {
  try {
    const { name, category, subCategory, description, aliases } = req.body;
    const normalizedName = name.trim().toLowerCase();

    const exist = await Skill.findOne({
      $or: [{ name: normalizedName }, { aliases: normalizedName }],
    });
    if (exist) {
      return res.status(400).json({
        msg: "Cette compétence existe déjà.",
        existingSkill: exist.name,
      });
    }

    const normalizedAliases = (aliases || [])
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean);

    const newSkill = await Skill.create({
      name: normalizedName,
      category: category?.trim() || null,
      subCategory: subCategory?.trim() || null,
      description: description?.trim() || null,
      aliases: normalizedAliases,
    });

    await logAdminAction(
      req.user.id,
      "skill_created",
      { type: "skill", id: newSkill._id },
      { name: normalizedName, category },
      req,
    );

    res.status(201).json(newSkill);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * PUT /api/admin/skills/:id
 * Update an official skill
 */
export const updateSkill = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, subCategory, description, aliases, isHidden } =
      req.body;

    const updates = {};
    if (name) updates.name = name.trim().toLowerCase();
    if (category !== undefined) updates.category = category?.trim() || null;
    if (subCategory !== undefined)
      updates.subCategory = subCategory?.trim() || null;
    if (description !== undefined)
      updates.description = description?.trim() || null;
    if (aliases)
      updates.aliases = aliases
        .map((a) => a.trim().toLowerCase())
        .filter(Boolean);
    if (isHidden !== undefined) updates.isHidden = isHidden;

    const skill = await Skill.findByIdAndUpdate(id, updates, { new: true });
    if (!skill) {
      return res.status(404).json({ msg: "Compétence introuvable" });
    }

    await logAdminAction(
      req.user.id,
      "skill_updated",
      { type: "skill", id: skill._id },
      { updates },
      req,
    );

    res.json({ msg: "Compétence mise à jour", skill });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * DELETE /api/admin/skills/:id
 */
export const deleteSkill = async (req, res) => {
  try {
    const skill = await Skill.findByIdAndDelete(req.params.id);
    if (!skill) {
      return res.status(404).json({ msg: "Compétence introuvable" });
    }

    await logAdminAction(
      req.user.id,
      "skill_deleted",
      { type: "skill", id: req.params.id },
      { name: skill.name },
      req,
    );

    res.json({ msg: "Compétence supprimée" });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// ─── Admin Cluster Endpoints ───

/**
 * GET /api/admin/skills/clusters/trending
 * Trending new skills
 */
export const getTrendingClusters = async (req, res) => {
  try {
    const { days = 30, limit = 20 } = req.query;

    const windowDays = await SystemSettings.getSetting(
      "skill_trending_window_days",
      parseInt(days),
    );

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - windowDays);

    const clusters = await SkillCluster.find({
      status: "pending",
      isFlagged: false,
      createdAt: { $gte: startDate },
    })
      .sort({ totalUsageCount: -1 })
      .limit(parseInt(limit))
      .lean();

    // Calculate growth rate
    const enriched = clusters.map((c) => {
      const daysSinceCreation = Math.max(
        1,
        (Date.now() - new Date(c.createdAt).getTime()) / (1000 * 60 * 60 * 24),
      );
      const growthRate = c.totalUsageCount / daysSinceCreation;

      return {
        ...c,
        growthRate: Math.round(growthRate * 100) / 100,
        variantCount: c.variants?.length || 0,
      };
    });

    enriched.sort((a, b) => b.growthRate - a.growthRate);

    res.json({ data: enriched, windowDays });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * GET /api/admin/skills/clusters/duplicates
 * High duplication clusters
 */
export const getDuplicateClusters = async (req, res) => {
  try {
    const { limit = 20 } = req.query;

    const clusters = await SkillCluster.find({
      status: "pending",
      "variants.1": { $exists: true }, // at least 2 variants
    })
      .sort({ totalUsageCount: -1 })
      .limit(parseInt(limit))
      .lean();

    const enriched = clusters.map((c) => ({
      ...c,
      variantCount: c.variants?.length || 0,
      variants: c.variants?.sort((a, b) => b.usageCount - a.usageCount),
    }));

    res.json({ data: enriched });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * GET /api/admin/skills/clusters/orphans
 * Frequently used, no official mapping
 */
export const getOrphanClusters = async (req, res) => {
  try {
    const { limit = 20, minUsage = 3 } = req.query;

    const clusters = await SkillCluster.find({
      status: "pending",
      promotedToSkillId: { $exists: false },
      isFlagged: false,
      totalUsageCount: { $gte: parseInt(minUsage) },
    })
      .sort({ totalUsageCount: -1 })
      .limit(parseInt(limit))
      .lean();

    res.json({ data: clusters });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * GET /api/admin/skills/clusters/flagged
 * Flagged / abusive skills
 */
export const getFlaggedClusters = async (req, res) => {
  try {
    const { limit = 20 } = req.query;

    const clusters = await SkillCluster.find({
      isFlagged: true,
    })
      .sort({ flagCount: -1, createdAt: -1 })
      .limit(parseInt(limit))
      .lean();

    res.json({ data: clusters });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * GET /api/admin/skills/clusters/:clusterId
 * Detailed cluster view
 */
export const getClusterDetail = async (req, res) => {
  try {
    const { clusterId } = req.params;

    const cluster = await SkillCluster.findById(clusterId)
      .populate("promotedToSkillId", "name category")
      .populate("promotedBy", "nom")
      .populate("dismissedBy", "nom");

    if (!cluster) {
      return res.status(404).json({ msg: "Cluster introuvable" });
    }

    // Get system suggestions
    const threshold = await SystemSettings.getSetting(
      "skill_suggestion_threshold",
      0.6,
    );

    const matchResult = await findBestMatch(cluster.canonicalName, threshold);

    // Count candidates using variants from this cluster
    const variantTexts = cluster.variants.map((v) => v.text);
    const candidateCount = await Candidate.countDocuments({
      "skills.normalizedText": { $in: variantTexts },
    });

    res.json({
      cluster,
      systemSuggestion: matchResult.match
        ? {
            name: matchResult.match.name,
            category: matchResult.match.category,
            confidence: matchResult.confidence,
          }
        : null,
      candidateCount,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * POST /api/admin/skills/clusters/:clusterId/promote
 * Promote a cluster to an official skill
 */
export const promoteCluster = async (req, res) => {
  try {
    const { clusterId } = req.params;
    const { name, domain, subDomain, description, aliasVariantTexts } =
      req.body;

    if (!name || !domain) {
      return res.status(400).json({ msg: "Nom et domaine sont obligatoires." });
    }

    const cluster = await SkillCluster.findById(clusterId);
    if (!cluster) {
      return res.status(404).json({ msg: "Cluster introuvable" });
    }

    if (cluster.status === "promoted") {
      return res.status(400).json({ msg: "Ce cluster a déjà été promu." });
    }

    const normalizedName = name.trim().toLowerCase();

    // Check if official skill already exists
    let officialSkill = await Skill.findOne({ name: normalizedName });

    const selectedAliases = (aliasVariantTexts || [])
      .map((a) => a.trim().toLowerCase())
      .filter((a) => a !== normalizedName);

    // Also add all variant texts as aliases
    const allVariantTexts = cluster.variants
      .map((v) => v.text)
      .filter((t) => t !== normalizedName);

    const combinedAliases = [
      ...new Set([...selectedAliases, ...allVariantTexts]),
    ];

    if (officialSkill) {
      // Merge aliases into existing skill
      const existingAliases = new Set(officialSkill.aliases || []);
      combinedAliases.forEach((a) => existingAliases.add(a));
      officialSkill.aliases = [...existingAliases];
      if (!officialSkill.category && domain)
        officialSkill.category = domain.trim();
      if (!officialSkill.subCategory && subDomain)
        officialSkill.subCategory = subDomain.trim();
      officialSkill.isPromoted = true;
      officialSkill.promotedFrom = cluster._id;
      await officialSkill.save();
    } else {
      officialSkill = await Skill.create({
        name: normalizedName,
        category: domain.trim(),
        subCategory: subDomain?.trim() || null,
        description: description?.trim() || null,
        aliases: combinedAliases,
        isPromoted: true,
        promotedFrom: cluster._id,
      });
    }

    // Update cluster
    cluster.status = "promoted";
    cluster.promotedToSkillId = officialSkill._id;
    cluster.promotedAt = new Date();
    cluster.promotedBy = req.user.id;
    await cluster.save();

    // Auto-migration if enabled
    const autoMigrate = await SystemSettings.getSetting(
      "skill_auto_migration_enabled",
      true,
    );

    let migratedCount = 0;

    if (autoMigrate) {
      const variantTexts = cluster.variants.map((v) => v.text);
      // Also include the canonical name
      const allTexts = [...new Set([...variantTexts, normalizedName])];

      // Find all candidates with matching unmatched skills
      const candidatesToUpdate = await Candidate.find({
        "skills.normalizedText": { $in: allTexts },
        "skills.matchType": { $in: ["unmatched", "fuzzy"] },
      });

      for (const candidate of candidatesToUpdate) {
        let changed = false;
        for (const skill of candidate.skills) {
          if (
            allTexts.includes(skill.normalizedText) &&
            ["unmatched", "fuzzy"].includes(skill.matchType)
          ) {
            // Record migration history
            skill.mappingHistory.push({
              previousOfficialId: skill.officialSkillId,
              previousOfficialName: skill.officialSkillName,
              newOfficialId: officialSkill._id,
              newOfficialName: officialSkill.name,
              reason: "cluster_promotion",
              migratedAt: new Date(),
            });

            skill.officialSkillId = officialSkill._id;
            skill.officialSkillName = officialSkill.name;
            skill.domain = officialSkill.category;
            skill.subDomain = officialSkill.subCategory;
            skill.matchType = "promoted";
            // rawText remains unchanged — user sees their original text
            changed = true;
          }
        }
        if (changed) {
          await candidate.save();
          migratedCount++;
        }
      }

      // Update usage count
      officialSkill.usageCount =
        (officialSkill.usageCount || 0) + cluster.totalUsageCount;
      await officialSkill.save();
    }

    await logAdminAction(
      req.user.id,
      "skill_cluster_promoted",
      { type: "skill_cluster", id: cluster._id },
      {
        officialSkillId: officialSkill._id,
        name: normalizedName,
        domain,
        aliasCount: combinedAliases.length,
        migratedCandidates: migratedCount,
      },
      req,
    );

    res.json({
      msg: "Compétence promue avec succès",
      skill: officialSkill,
      migratedCandidates: migratedCount,
      aliasesAdded: combinedAliases.length,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * POST /api/admin/skills/clusters/:clusterId/dismiss
 */
export const dismissCluster = async (req, res) => {
  try {
    const { clusterId } = req.params;
    const { reason } = req.body;

    const cluster = await SkillCluster.findById(clusterId);
    if (!cluster) {
      return res.status(404).json({ msg: "Cluster introuvable" });
    }

    cluster.status = "dismissed";
    cluster.dismissedAt = new Date();
    cluster.dismissedBy = req.user.id;
    cluster.dismissReason = reason;
    await cluster.save();

    await logAdminAction(
      req.user.id,
      "skill_cluster_dismissed",
      { type: "skill_cluster", id: cluster._id },
      { reason },
      req,
    );

    res.json({ msg: "Cluster rejeté" });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * POST /api/admin/skills/clusters/:clusterId/flag
 * Manually flag a cluster
 */
export const flagCluster = async (req, res) => {
  try {
    const { clusterId } = req.params;
    const { reason } = req.body;

    const cluster = await SkillCluster.findById(clusterId);
    if (!cluster) {
      return res.status(404).json({ msg: "Cluster introuvable" });
    }

    cluster.isFlagged = true;
    cluster.flagCount += 1;
    cluster.flagReasons.push({
      reason: reason || "admin_flagged",
      flaggedBy: "admin",
      flaggedAt: new Date(),
    });
    await cluster.save();

    // Hide from recruiters
    const maxFlags = await SystemSettings.getSetting(
      "skill_abuse_max_flags_before_hide",
      3,
    );

    if (cluster.flagCount >= maxFlags) {
      const variantTexts = cluster.variants.map((v) => v.text);
      await Candidate.updateMany(
        { "skills.normalizedText": { $in: variantTexts } },
        { $set: { "skills.$[elem].isVisibleToRecruiters": false } },
        { arrayFilters: [{ "elem.normalizedText": { $in: variantTexts } }] },
      );
    }

    res.json({ msg: "Cluster signalé", flagCount: cluster.flagCount });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * POST /api/admin/skills/clusters/:clusterId/unflag
 */
export const unflagCluster = async (req, res) => {
  try {
    const { clusterId } = req.params;

    const cluster = await SkillCluster.findById(clusterId);
    if (!cluster) {
      return res.status(404).json({ msg: "Cluster introuvable" });
    }

    cluster.isFlagged = false;
    cluster.status = "pending";
    await cluster.save();

    // Restore visibility
    const variantTexts = cluster.variants.map((v) => v.text);
    await Candidate.updateMany(
      {
        "skills.normalizedText": { $in: variantTexts },
        "skills.flagReason": "auto_detected_abuse",
      },
      {
        $set: {
          "skills.$[elem].isVisibleToRecruiters": true,
          "skills.$[elem].isFlagged": false,
          "skills.$[elem].flagReason": null,
        },
      },
      {
        arrayFilters: [
          {
            "elem.normalizedText": { $in: variantTexts },
            "elem.flagReason": "auto_detected_abuse",
          },
        ],
      },
    );

    res.json({ msg: "Cluster débloqué" });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// ─── Admin Feedback Endpoints ───

/**
 * GET /api/admin/skills/feedback
 */
export const getSkillFeedback = async (req, res) => {
  try {
    const { status = "pending", page = 1, limit = 20 } = req.query;

    let query = {};
    if (status !== "all") query.status = status;

    const [feedbacks, total] = await Promise.all([
      SkillFeedback.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .populate("userId", "nom email")
        .populate("mappedToSkillId", "name category")
        .populate("reviewedBy", "nom")
        .lean(),
      SkillFeedback.countDocuments(query),
    ]);

    res.json({
      data: feedbacks,
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
 * POST /api/admin/skills/feedback/:feedbackId/review
 */
export const reviewSkillFeedback = async (req, res) => {
  try {
    const { feedbackId } = req.params;
    const { action, note } = req.body;

    const validActions = [
      "mapping_adjusted",
      "mapping_removed",
      "no_change",
      "user_flagged",
    ];
    if (!action || !validActions.includes(action)) {
      return res.status(400).json({ msg: "Action invalide." });
    }

    const feedback = await SkillFeedback.findById(feedbackId);
    if (!feedback) {
      return res.status(404).json({ msg: "Feedback introuvable" });
    }

    feedback.status = action === "no_change" ? "rejected" : "accepted";
    feedback.reviewedBy = req.user.id;
    feedback.reviewedAt = new Date();
    feedback.reviewNote = note;
    feedback.actionTaken = action;
    await feedback.save();

    // If mapping_removed, remove the official mapping from the candidate's skill
    if (action === "mapping_removed") {
      const candidate = await Candidate.findById(feedback.candidateId);
      if (candidate) {
        const skill = candidate.skills.id(feedback.candidateSkillId);
        if (skill) {
          skill.mappingHistory.push({
            previousOfficialId: skill.officialSkillId,
            previousOfficialName: skill.officialSkillName,
            newOfficialId: null,
            newOfficialName: null,
            reason: "feedback_accepted",
            migratedAt: new Date(),
          });
          skill.officialSkillId = null;
          skill.officialSkillName = null;
          skill.domain = null;
          skill.subDomain = null;
          skill.matchType = "unmatched";
          await candidate.save();
        }
      }
    }

    // If user_flagged, reduce trust score
    if (action === "user_flagged") {
      await Candidate.findByIdAndUpdate(feedback.candidateId, {
        $inc: { skillTrustScore: -10 },
      });
    }

    await logAdminAction(
      req.user.id,
      "skill_feedback_reviewed",
      { type: "skill_feedback", id: feedback._id },
      { action, note },
      req,
    );

    res.json({ msg: "Feedback traité", feedback });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// ─── Admin Stats ───

/**
 * GET /api/admin/skills/stats
 */
export const getSkillSystemStats = async (req, res) => {
  try {
    const [
      totalOfficialSkills,
      totalClusters,
      pendingClusters,
      flaggedClusters,
      promotedClusters,
      pendingFeedback,
      totalFeedback,
      topSkills,
      recentClusters,
      categoryDistribution,
    ] = await Promise.all([
      Skill.countDocuments({ isHidden: { $ne: true } }),
      SkillCluster.countDocuments(),
      SkillCluster.countDocuments({ status: "pending", isFlagged: false }),
      SkillCluster.countDocuments({ isFlagged: true }),
      SkillCluster.countDocuments({ status: "promoted" }),
      SkillFeedback.countDocuments({ status: "pending" }),
      SkillFeedback.countDocuments(),
      Skill.find({ isHidden: { $ne: true } })
        .sort({ usageCount: -1 })
        .limit(10)
        .select("name category usageCount")
        .lean(),
      SkillCluster.find({ status: "pending" })
        .sort({ createdAt: -1 })
        .limit(5)
        .select("canonicalName totalUsageCount createdAt")
        .lean(),
      Skill.aggregate([
        {
          $match: {
            isHidden: { $ne: true },
            category: { $exists: true, $ne: null },
          },
        },
        { $group: { _id: "$category", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    res.json({
      officialSkills: totalOfficialSkills,
      clusters: {
        total: totalClusters,
        pending: pendingClusters,
        flagged: flaggedClusters,
        promoted: promotedClusters,
      },
      feedback: {
        pending: pendingFeedback,
        total: totalFeedback,
      },
      topSkills,
      recentClusters,
      categoryDistribution,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// ─── Admin Settings Endpoints ───

/**
 * GET /api/admin/skills/settings
 */
export const getSkillSettings = async (req, res) => {
  try {
    const settings = await SystemSettings.getSettingsByCategory("skills");
    res.json(settings);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/**
 * PUT /api/admin/skills/settings
 * Update multiple skill settings at once
 */
export const updateSkillSettings = async (req, res) => {
  try {
    const { settings } = req.body;

    if (!settings || typeof settings !== "object") {
      return res.status(400).json({ msg: "Settings object requis." });
    }

    const validSkillKeys = [
      "skill_system_enabled",
      "max_skills_per_candidate",
      "skill_proposal_enabled",
      "skill_suggestions_enabled",
      "skill_suggestion_threshold",
      "skill_level_enabled",
      "skill_feedback_enabled",
      "skill_feedback_max_per_week",
      "skill_feedback_max_per_skill",
      "skill_abuse_detection_enabled",
      "skill_abuse_max_flags_before_hide",
      "skill_auto_migration_enabled",
      "skill_recruiter_search_expand_aliases",
      "skill_trending_window_days",
    ];

    const updates = {};
    for (const [key, value] of Object.entries(settings)) {
      if (!validSkillKeys.includes(key)) {
        return res.status(400).json({ msg: `Clé invalide: ${key}` });
      }
      updates[key] = value;
    }

    for (const [key, value] of Object.entries(updates)) {
      await SystemSettings.setSetting(key, value, null, req.user.id);
    }

    await logAdminAction(
      req.user.id,
      "skill_settings_updated",
      { type: "system_settings" },
      { updates },
      req,
    );

    const updatedSettings =
      await SystemSettings.getSettingsByCategory("skills");

    res.json({
      msg: "Paramètres des compétences mis à jour",
      settings: updatedSettings,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export default {
  // Public
  getSkills,
  getSkillProposalStatus,
  suggestSkills,
  // Candidate
  addSkillToCandidate,
  updateCandidateSkill,
  deleteCandidateSkill,
  getSkillDetails,
  submitSkillFeedback,
  // Admin CRUD
  createSkill,
  updateSkill,
  deleteSkill,
  // Admin Clusters
  getTrendingClusters,
  getDuplicateClusters,
  getOrphanClusters,
  getFlaggedClusters,
  getClusterDetail,
  promoteCluster,
  dismissCluster,
  flagCluster,
  unflagCluster,
  // Admin Feedback
  getSkillFeedback,
  reviewSkillFeedback,
  // Admin Stats & Settings
  getSkillSystemStats,
  getSkillSettings,
  updateSkillSettings,
};
