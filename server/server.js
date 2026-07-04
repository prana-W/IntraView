import "dotenv/config";
import express         from "express";
import cors            from "cors";
import mongoose        from "mongoose";
import fs              from "fs";
import path            from "path";
import { fileURLToPath } from "url";
import { pipeline, env } from "@xenova/transformers";

import authRoutes      from "./routes/auth.js";
import { authenticate } from "./middleware/authenticate.js";
import Transcript      from "./models/Transcript.js";

const __dirname       = path.dirname(fileURLToPath(import.meta.url));
const PORT            = process.env.PORT || 8765;
const TRANSCRIPTS_DIR = path.join(__dirname, "transcripts");
const AUDIO_DIR       = path.join(__dirname, "audio");

for (const dir of [TRANSCRIPTS_DIR, AUDIO_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}


await mongoose.connect(process.env.MONGO_URI);
console.log(`✅ MongoDB connected: ${process.env.MONGO_URI}\n`);


console.log("╔══════════════════════════════════════════════════╗");
console.log("║   IntraView – Loading Whisper (whisper-tiny.en)  ║");
console.log("║   First run downloads ~40 MB. Please wait…       ║");
console.log("╚══════════════════════════════════════════════════╝\n");

const transcriber = await pipeline(
  "automatic-speech-recognition",
  "Xenova/whisper-tiny.en",
  { quantized: true }
);

console.log("✅ Whisper model ready!\n");


function decodeWAV(buf) {
  const view       = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const numSamples = (buf.byteLength - 44) / 2;
  const out        = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    out[i] = view.getInt16(44 + i * 2, true) / 32768;
  }
  return out;
}


function parseProblemTitle(url = "") {
  const m = url.match(/\/problems\/([^/?#]+)/);
  return m ? m[1] : "unknown";
}


function tempTxtPath(userId, sessionId) {
  return path.join(TRANSCRIPTS_DIR, `${userId}-${sessionId}.txt`);
}


function appendToTemp(userId, sessionId, text) {
  const stamp = new Date().toLocaleTimeString("en-IN", { hour12: false });
  fs.appendFileSync(tempTxtPath(userId, sessionId), `[${stamp}] ${text}\n`, "utf8");
}


const app = express();

app.use(cors({
  origin: "*",          
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Session-Id", "X-Chunk-Index",
                   "X-Problem-Url", "X-Recording-Done"],
}));

// Global request logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});


app.use((req, res, next) => {
  if (req.headers["content-type"]?.startsWith("audio/")) {
  
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end",  () => { req.rawBody = Buffer.concat(chunks); next(); });
  } else {
    express.json()(req, res, next);
  }
});


app.use("/auth", authRoutes);


app.get("/health", (_req, res) => res.json({ status: "ok" }));


app.post("/transcribe", authenticate, async (req, res) => {
  try {
    const audioBuf    = req.rawBody;
    if (!audioBuf || audioBuf.length < 44)
      return res.status(400).json({ error: "Empty or invalid WAV body" });

    const sessionId   = (req.headers["x-session-id"]   ?? "unknown").slice(0, 40);
    const chunkIndex  = String(req.headers["x-chunk-index"] ?? "0").padStart(3, "0");
    const problemUrl  = req.headers["x-problem-url"]  ?? "";
    const isDone      = req.headers["x-recording-done"] === "true";
    const { id: userId } = req.user;

    // Save raw audio file
    const now      = new Date();
    const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
    const timePart = now.toTimeString().slice(0, 8).replace(/:/g, "");
    const audioFile = path.join(AUDIO_DIR, `${datePart}-${timePart}-chunk-${chunkIndex}.wav`);
    fs.writeFileSync(audioFile, audioBuf);
    console.log(`[+] Chunk ${chunkIndex} | user=${req.user.username} | ${(audioBuf.length/1024).toFixed(1)} KB`);

    // Transcribe
    console.log(`    Transcribing chunk ${chunkIndex}…`);
    const samples  = decodeWAV(audioBuf);
    const result   = await transcriber(samples, { sampling_rate: 16000 });
    const transcript = (result?.text ?? "").trim();
    console.log(`    → "${transcript}"`);

    // Append to per-session temp file
    if (transcript) appendToTemp(userId, sessionId, transcript);

    // Delete audio file after transcription
    try { fs.unlinkSync(audioFile); } catch {}

    // If this is the final chunk, persist to MongoDB and clean up
    if (isDone) {
      const txtFile = tempTxtPath(userId, sessionId);
      let fullText  = "";
      if (fs.existsSync(txtFile)) {
        fullText = fs.readFileSync(txtFile, "utf8").trim();
        try { fs.unlinkSync(txtFile); } catch {}
      }

      const problemTitle = parseProblemTitle(problemUrl);
      await Transcript.create({
        userId,
        problemTitle,
        problemLink:     problemUrl,
        audioTranscript: fullText,
      });
      console.log(`    ✅ Transcript saved to MongoDB (problem: ${problemTitle})\n`);
    }

    res.json({ transcript, done: isDone });
  } catch (err) {
    console.error("[!] Transcription error:", err.message);
    res.status(500).json({ error: err.message });
  }
});


// ── Get all transcripts for the user (protected) ─────────────────────────────
app.get("/transcripts", authenticate, async (req, res) => {
  try {
    const transcripts = await Transcript.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .select("problemTitle problemLink audioTranscript createdAt");
    res.json({ transcripts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get single transcript (protected, must belong to user) ────────────────────
app.get("/transcripts/:id", authenticate, async (req, res) => {
  try {
    const transcript = await Transcript.findOne({ _id: req.params.id, userId: req.user.id });
    if (!transcript) return res.status(404).json({ error: "Not found" });
    res.json({ transcript });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   IntraView – Transcript Server Running      ║");
  console.log(`║   POST http://localhost:${PORT}/transcribe     ║`);
  console.log(`║   GET  http://localhost:${PORT}/health         ║`);
  console.log("╚══════════════════════════════════════════════╝\n");
  console.log("Waiting for recordings…\n");
});
