import { validationResult, body, param, query } from "express-validator";

// Validation error handler
export const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      msg: "Données invalides",
      errors: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }
  next();
};

// Common validators
export const validators = {
  // Auth validators
  register: [
    body("nom")
      .trim()
      .notEmpty()
      .withMessage("Le nom est requis")
      .isLength({ max: 100 }),
    body("email")
      .trim()
      .isEmail()
      .withMessage("Email invalide")
      .normalizeEmail(),
    body("motDePasse")
      .isLength({ min: 8 })
      .withMessage("Le mot de passe doit contenir au moins 8 caractères")
      .matches(/[a-z]/)
      .withMessage("Le mot de passe doit contenir une minuscule")
      .matches(/[A-Z]/)
      .withMessage("Le mot de passe doit contenir une majuscule")
      .matches(/\d/)
      .withMessage("Le mot de passe doit contenir un chiffre"),
    body("role").isIn(["candidat", "recruteur"]).withMessage("Rôle invalide"),
    handleValidationErrors,
  ],

  login: [
    body("email")
      .trim()
      .isEmail()
      .withMessage("Email invalide")
      .normalizeEmail(),
    body("motDePasse").notEmpty().withMessage("Mot de passe requis"),
    handleValidationErrors,
  ],

  verifyEmail: [
    body("code")
      .trim()
      .notEmpty()
      .withMessage("Code requis")
      .isLength({ min: 6, max: 6 }),
    handleValidationErrors,
  ],

  changeEmail: [
    body("newEmail")
      .trim()
      .isEmail()
      .withMessage("Email invalide")
      .normalizeEmail(),
    handleValidationErrors,
  ],

  // Candidate validators
  updateProfile: [
    body("telephone")
      .optional()
      .trim()
      .matches(/^[0-9+\s-]{8,20}$/)
      .withMessage("Téléphone invalide"),
    body("bio")
      .optional()
      .trim()
      .isLength({ max: 1000 })
      .withMessage("Bio trop longue (max 1000)"),
    body("dateOfBirth").optional().isISO8601().withMessage("Date invalide"),
    body("gender")
      .optional()
      .isIn(["homme", "femme"])
      .withMessage("Genre invalide"),
    handleValidationErrors,
  ],

  applyToOffer: [
    body("offreId").isMongoId().withMessage("ID offre invalide"),
    body("cvUrl").notEmpty().withMessage("CV requis"),
    body("coverLetter")
      .optional()
      .trim()
      .isLength({ max: 5000 })
      .withMessage("Lettre trop longue"),
    handleValidationErrors,
  ],

  addSkill: [
    body("name")
      .trim()
      .notEmpty()
      .withMessage("Nom requis")
      .isLength({ max: 100 }),
    body("level").optional().isIn(["beginner", "intermediate", "expert"]),
    handleValidationErrors,
  ],
  addSkillV2: [
    body("name")
      .trim()
      .notEmpty()
      .withMessage("Nom requis")
      .isLength({ min: 1, max: 100 })
      .withMessage("Le nom doit faire entre 1 et 100 caractères"),
    body("level")
      .optional()
      .isIn(["beginner", "intermediate", "expert", "unset"])
      .withMessage("Niveau invalide"),
    body("selectedSuggestionId")
      .optional()
      .isMongoId()
      .withMessage("ID suggestion invalide"),
    handleValidationErrors,
  ],

  skillFeedback: [
    body("category")
      .isIn([
        "incorrect_mapping",
        "wrong_domain",
        "skill_merged_incorrectly",
        "other",
      ])
      .withMessage("Catégorie invalide"),
    body("comment")
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage("Commentaire trop long (max 500)"),
    handleValidationErrors,
  ],

  addExperience: [
    body("jobTitle")
      .trim()
      .notEmpty()
      .withMessage("Titre requis")
      .isLength({ max: 200 }),
    body("company")
      .trim()
      .notEmpty()
      .withMessage("Entreprise requise")
      .isLength({ max: 200 }),
    body("startDate").optional().isISO8601().withMessage("Date invalide"),
    body("endDate").optional().isISO8601().withMessage("Date invalide"),
    handleValidationErrors,
  ],

  addEducation: [
    body("institut")
      .trim()
      .notEmpty()
      .withMessage("Institut requis")
      .isLength({ max: 200 }),
    body("degree")
      .trim()
      .notEmpty()
      .withMessage("Diplôme requis")
      .isLength({ max: 200 }),
    body("startDate").optional().isISO8601().withMessage("Date invalide"),
    handleValidationErrors,
  ],

  // Support validators
  createTicket: [
    body("subject")
      .trim()
      .notEmpty()
      .withMessage("Sujet requis")
      .isLength({ max: 200 }),
    body("description")
      .trim()
      .notEmpty()
      .withMessage("Description requise")
      .isLength({ max: 5000 }),
    body("category")
      .isIn([
        "support_understanding",
        "technical_issue",
        "account_profile",
        "company_recruitment",
        "documents_verification",
        "special_request",
        "feedback_suggestion",
      ])
      .withMessage("Catégorie invalide"),
    handleValidationErrors,
  ],

  replyToTicket: [
    body("content")
      .trim()
      .notEmpty()
      .withMessage("Contenu requis")
      .isLength({ max: 5000 }),
    handleValidationErrors,
  ],

  // Param validators
  mongoId: (paramName = "id") => [
    param(paramName).isMongoId().withMessage("ID invalide"),
    handleValidationErrors,
  ],

  // Query validators
  pagination: [
    query("page").optional().isInt({ min: 1 }).toInt(),
    query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
    handleValidationErrors,
  ],
  forgotPassword: [
    body("email")
      .trim()
      .isEmail()
      .withMessage("Adresse email invalide")
      .normalizeEmail(),
    handleValidationErrors,
  ],

  verifyResetCode: [
    body("email")
      .trim()
      .isEmail()
      .withMessage("Adresse email invalide")
      .normalizeEmail(),
    body("code")
      .trim()
      .notEmpty()
      .withMessage("Code requis")
      .isLength({ min: 6, max: 6 })
      .withMessage("Le code doit contenir 6 chiffres"),
    handleValidationErrors,
  ],

  resetPassword: [
    body("resetToken")
      .trim()
      .notEmpty()
      .withMessage("Token de réinitialisation requis"),
    body("newPassword")
      .isLength({ min: 8 })
      .withMessage("Le mot de passe doit contenir au moins 8 caractères")
      .matches(/[a-z]/)
      .withMessage("Le mot de passe doit contenir une minuscule")
      .matches(/[A-Z]/)
      .withMessage("Le mot de passe doit contenir une majuscule")
      .matches(/\d/)
      .withMessage("Le mot de passe doit contenir un chiffre"),
    body("confirmPassword")
      .optional()
      .custom((value, { req }) => {
        if (value !== req.body.newPassword) {
          throw new Error("Les mots de passe ne correspondent pas");
        }
        return true;
      }),
    handleValidationErrors,
  ],
};

export default validators;
