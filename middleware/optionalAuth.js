import jwt from "jsonwebtoken";

export const optionalAuth = (req, res, next) => {
  const token = req.header("Authorization");

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
  } catch (err) {
    req.user = null;
  }
  next();
};
