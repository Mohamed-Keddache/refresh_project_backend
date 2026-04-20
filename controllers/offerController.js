import Offer from "../models/Offer.js";
import Company from "../models/Company.js";

const toCursor = (payload) => {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
};

const fromCursor = (cursor) => {
  try {
    return JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
  } catch (e) {
    return null;
  }
};

// ══════════════════════════════════════════════════════════════
// FEATURE 2.5: Ajout du `totalCount` dans la réponse
// (nombre total d'offres correspondant aux filtres, sans pagination)
// ══════════════════════════════════════════════════════════════
export const getAllActiveOffers = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const {
      cursor,
      wilaya,
      sort,
      search,
      type,
      domaine,
      experienceLevel,
      minSalary,
      maxSalary,
      hasAnem,
    } = req.query;

    let query = {
      actif: true,
      validationStatus: "approved",
      isDeletedByRecruiter: { $ne: true },
    };

    if (wilaya) {
      query.wilaya = { $regex: new RegExp(`^${wilaya}$`, "i") };
    }

    if (type) {
      query.type = type;
    }

    if (domaine) {
      query.domaine = domaine;
    }

    if (experienceLevel) {
      query.experienceLevel = experienceLevel;
    }

    if (minSalary) {
      query.salaryMax = { $gte: parseInt(minSalary) };
    }

    if (maxSalary) {
      query.salaryMin = { $lte: parseInt(maxSalary) };
    }

    if (hasAnem === "true") {
      query.isAnem = true;
    } else if (hasAnem === "false") {
      query.isAnem = { $ne: true };
    }

    if (search) {
      const matchingCompanies = await Company.find({
        name: { $regex: search, $options: "i" },
      }).select("_id");

      const companyIds = matchingCompanies.map((c) => c._id);

      query.$or = [
        { titre: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { skills: { $in: [new RegExp(search, "i")] } },
        { companyId: { $in: companyIds } },
      ];
    }

    // Copie de la query AVANT l'ajout du curseur pour le count
    const countQuery = { ...query };
    if (countQuery.$and) {
      countQuery.$and = [...countQuery.$and];
    }

    if (cursor) {
      const decrypted = fromCursor(cursor);

      if (decrypted) {
        const { id, value } = decrypted;

        if (sort === "popular") {
          query.$and = [
            ...(query.$and || []),
            {
              $or: [
                { nombreCandidatures: { $lt: value } },
                { nombreCandidatures: value, _id: { $lt: id } },
              ],
            },
          ];
        } else {
          query.$and = [
            ...(query.$and || []),
            {
              $or: [
                { datePublication: { $lt: new Date(value) } },
                { datePublication: new Date(value), _id: { $lt: id } },
              ],
            },
          ];
        }
      }
    }

    let sortQuery = {};
    if (sort === "popular") {
      sortQuery = { nombreCandidatures: -1, _id: -1 };
    } else {
      sortQuery = { datePublication: -1, _id: -1 };
    }

    // Exécuter la requête d'offres et le count total en parallèle
    const [offers, totalCount] = await Promise.all([
      Offer.find(query)
        .populate("companyId", "name logo location industry")
        .populate("recruteurId", "position")
        .sort(sortQuery)
        .limit(limit + 1),
      Offer.countDocuments(countQuery),
    ]);

    const hasNextPage = offers.length > limit;
    const data = hasNextPage ? offers.slice(0, limit) : offers;

    const enrichedData = data.map((offer) => {
      const isNew =
        new Date() - new Date(offer.datePublication) < 2 * 24 * 60 * 60 * 1000;
      return {
        ...offer.toObject(),
        isNew,
        hasAnem: offer.isAnem || false,
      };
    });

    let nextCursor = null;
    if (hasNextPage && data.length > 0) {
      const lastItem = data[data.length - 1];

      const cursorValue =
        sort === "popular"
          ? lastItem.nombreCandidatures
          : lastItem.datePublication;

      nextCursor = toCursor({
        id: lastItem._id,
        value: cursorValue,
      });
    }

    res.json({
      data: enrichedData,
      meta: {
        nextCursor,
        hasNextPage,
        limit,
        totalCount, // FEATURE 2.5: nombre total d'offres
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: err.message });
  }
};

export const getOfferDetails = async (req, res) => {
  try {
    const offer = await Offer.findOne({
      _id: req.params.id,
      actif: true,
      isDeletedByRecruiter: { $ne: true },
    })
      .populate("companyId", "name logo website description location size")
      .populate("recruteurId", "position");

    if (!offer) return res.status(404).json({ msg: "Offre introuvable" });

    const isNew =
      new Date() - new Date(offer.datePublication) < 2 * 24 * 60 * 60 * 1000;

    res.json({
      ...offer.toObject(),
      isNew,
      hasAnem: offer.isAnem || false,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: err.message });
  }
};

// ══════════════════════════════════════════════════════════════
// FEATURE 2.3: Métadonnées pour les filtres du frontend
// Retourne les listes dynamiques (wilayas, domaines, types, etc.)
// à partir des offres actives en base.
// ══════════════════════════════════════════════════════════════
export const getOfferFilters = async (req, res) => {
  try {
    const baseQuery = {
      actif: true,
      validationStatus: "approved",
      isDeletedByRecruiter: { $ne: true },
    };

    const [wilayas, domaines, types, experienceLevels] = await Promise.all([
      Offer.distinct("wilaya", {
        ...baseQuery,
        wilaya: { $exists: true, $nin: [null, ""] },
      }),
      Offer.distinct("domaine", {
        ...baseQuery,
        domaine: { $exists: true, $nin: [null, ""] },
      }),
      Offer.distinct("type", baseQuery),
      Offer.distinct("experienceLevel", {
        ...baseQuery,
        experienceLevel: { $exists: true, $nin: [null, ""] },
      }),
    ]);

    // Récupérer min/max salaire pour les sliders
    const salaryRange = await Offer.aggregate([
      { $match: baseQuery },
      {
        $group: {
          _id: null,
          minSalary: { $min: "$salaryMin" },
          maxSalary: { $max: "$salaryMax" },
        },
      },
    ]);

    res.json({
      wilayas: wilayas.filter(Boolean).sort(),
      domaines: domaines.filter(Boolean).sort(),
      types: types.filter(Boolean),
      experienceLevels: experienceLevels.filter(Boolean),
      salaryRange: salaryRange[0]
        ? {
            min: salaryRange[0].minSalary || 0,
            max: salaryRange[0].maxSalary || 0,
          }
        : { min: 0, max: 0 },
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// ══════════════════════════════════════════════════════════════
// FEATURE 2.6: Profil public d'une entreprise
// Accessible aux candidats pour voir les détails d'un employeur.
// ══════════════════════════════════════════════════════════════
export const getCompanyPublicProfile = async (req, res) => {
  try {
    const { companyId } = req.params;

    const company = await Company.findOne({
      _id: companyId,
      status: "active",
    })
      .select("name logo website description industry location size")
      .lean();

    if (!company) {
      return res.status(404).json({ msg: "Entreprise introuvable" });
    }

    // Compter les offres actives de cette entreprise
    const activeOfferCount = await Offer.countDocuments({
      companyId,
      actif: true,
      validationStatus: "approved",
      isDeletedByRecruiter: { $ne: true },
    });

    // Récupérer les dernières offres actives
    const recentOffers = await Offer.find({
      companyId,
      actif: true,
      validationStatus: "approved",
      isDeletedByRecruiter: { $ne: true },
    })
      .select("titre type wilaya salaryMin salaryMax datePublication")
      .sort({ datePublication: -1 })
      .limit(10)
      .lean();

    res.json({
      ...company,
      activeOfferCount,
      recentOffers,
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};
