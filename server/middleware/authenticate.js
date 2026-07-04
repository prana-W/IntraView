import jwt from "jsonwebtoken";


export function authenticate(req, res, next) {
  const header = req.headers["authorization"] ?? "";
  const token  = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.id, username: payload.username, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
