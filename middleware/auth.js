import jwt from "jsonwebtoken";

export default function auth(req, res, next) {
  // More robust:
  const authHeader = req.header("Authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;
  if (!token) return res.status(401).json({ msg: "Pas de token fourni" });
  if (!token) return res.status(401).json({ msg: "Pas de token fourni" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ msg: "Token invalide" });
  }
}
