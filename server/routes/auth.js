import { Router }  from "express";
import jwt          from "jsonwebtoken";
import User         from "../models/User.js";
import { authenticate } from "../middleware/authenticate.js";

const router = Router();
const COOKIE_MAX_AGE = 10 * 24 * 60 * 60 * 1000; // 10 days ms

function makeToken(user) {
  return jwt.sign(
    { id: user._id, username: user.username, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: "10d" }
  );
}

// POST /auth/register
router.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password)
      return res.status(400).json({ error: "username, email and password are required" });

    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing)
      return res.status(409).json({ error: "Username or email already taken" });

    const user  = new User({ username, email, passwordHash: password });
    await user.save();

    const token = makeToken(user);
    res.json({ token, expiresIn: COOKIE_MAX_AGE, user: { id: user._id, username: user.username, email: user.email } });
  } catch (err) {
    console.error("[Auth] Register error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /auth/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "email and password are required" });

    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({ error: "Invalid credentials" });

    const token = makeToken(user);
    res.json({ token, expiresIn: COOKIE_MAX_AGE, user: { id: user._id, username: user.username, email: user.email } });
  } catch (err) {
    console.error("[Auth] Login error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /auth/whoami  – used by content.js to check session on page load
router.get("/whoami", authenticate, (req, res) => {
  res.json({ user: req.user });
});

export default router;
