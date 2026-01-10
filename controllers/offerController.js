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
    } = req.query;

    let query = { actif: true, validationStatus: "approved" };

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

    const offers = await Offer.find(query)
      .populate("companyId", "name logo location industry")
      .populate("recruteurId", "position")
      .sort(sortQuery)
      .limit(limit + 1);

    const hasNextPage = offers.length > limit;
    const data = hasNextPage ? offers.slice(0, limit) : offers;

    const enrichedData = data.map((offer) => {
      const isNew =
        new Date() - new Date(offer.datePublication) < 2 * 24 * 60 * 60 * 1000;
      return { ...offer.toObject(), isNew };
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
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: err.message });
  }
};

export const getOfferDetails = async (req, res) => {
  try {
    const offer = await Offer.findOne({ _id: req.params.id, actif: true })
      .populate("companyId", "name logo website description location size")
      .populate("recruteurId", "position");

    if (!offer) return res.status(404).json({ msg: "Offre introuvable" });

    const isNew =
      new Date() - new Date(offer.datePublication) < 2 * 24 * 60 * 60 * 1000;

    res.json({ ...offer.toObject(), isNew });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: err.message });
  }
};
