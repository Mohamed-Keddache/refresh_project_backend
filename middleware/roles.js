export const authRole = (roles = []) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ msg: "Accès refusé : rôle non autorisé" });
    }
    next();
  };
};
