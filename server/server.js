import "dotenv/config";
import express         from "express";
import cors            from "cors";
import mongoose        from "mongoose";
import fs              from "fs";
import path            from "path";
import { fileURLToPath } from "url";
import { pipeline, env } from "@xenova/transformers";

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


function tempTxtPath(sessionId) {
  return path.join(TRANSCRIPTS_DIR, `${sessionId}.txt`);
}


function appendToTemp(sessionId, chunkIndex, text) {
  const idx = parseInt(chunkIndex, 10) || 0;
  const totalSeconds = idx * 25;
  const h = Math.floor(totalSeconds / 3600).toString().padStart(2, "0");
  const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, "0");
  const s = (totalSeconds % 60).toString().padStart(2, "0");
  const stamp = `${h}:${m}:${s}`;
  fs.appendFileSync(tempTxtPath(sessionId), `[${stamp}] ${text}\n`, "utf8");
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
  console.log(`${req.method} ${req.url}`);
  next();
});

// Serve audio statically
app.use("/audio", express.static(AUDIO_DIR));

app.use((req, res, next) => {
  if (req.headers["content-type"]?.startsWith("audio/")) {
  
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end",  () => { req.rawBody = Buffer.concat(chunks); next(); });
  } else {
    express.json()(req, res, next);
  }
});


app.get("/health", (_req, res) => res.json({ status: "ok" }));


app.post("/audio/:sessionId", (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    const audioBuf = req.rawBody;
    if (!audioBuf) return res.status(400).json({ error: "Empty body" });
    const audioFile = path.join(AUDIO_DIR, `${sessionId}.webm`);
    fs.writeFileSync(audioFile, audioBuf);
    console.log(`    ✅ Saved full audio recording for session ${sessionId}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.post("/transcribe", async (req, res) => {
  try {
    const audioBuf    = req.rawBody;
    if (!audioBuf || audioBuf.length < 44)
      return res.status(400).json({ error: "Empty or invalid WAV body" });

    const sessionId   = (req.headers["x-session-id"]   ?? "unknown").slice(0, 40);
    const chunkIndex  = String(req.headers["x-chunk-index"] ?? "0").padStart(3, "0");
    const problemUrl  = req.headers["x-problem-url"]  ?? "";
    const isDone      = req.headers["x-recording-done"] === "true";
        // Save raw audio file
    const now      = new Date();
    const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
    const timePart = now.toTimeString().slice(0, 8).replace(/:/g, "");
    const audioFile = path.join(AUDIO_DIR, `${datePart}-${timePart}-chunk-${chunkIndex}.wav`);
    fs.writeFileSync(audioFile, audioBuf);
    console.log(`[+] Chunk ${chunkIndex} | ${(audioBuf.length/1024).toFixed(1)} KB`);

    // Transcribe
    console.log(`    Transcribing chunk ${chunkIndex}…`);
    const samples  = decodeWAV(audioBuf);
    const result   = await transcriber(samples, { sampling_rate: 16000 });
    const transcript = (result?.text ?? "").trim();
    console.log(`    → "${transcript}"`);

    // Append to per-session temp file
    if (transcript) appendToTemp(sessionId, chunkIndex, transcript);

    // Delete audio file after transcription
    try { fs.unlinkSync(audioFile); } catch {}

    // If this is the final chunk, persist to MongoDB and clean up
    if (isDone) {
      const txtFile = tempTxtPath(sessionId);
      let fullText  = "";
      if (fs.existsSync(txtFile)) {
        fullText = fs.readFileSync(txtFile, "utf8").trim();
        // Remove lines that only contain noise like (upbeat music), [BLANK_AUDIO], etc.
        fullText = fullText.split('\n').filter(line => {
          const textPart = line.replace(/^\[.*?\]\s*/, '').trim();
          return textPart.replace(/\([^)]*\)|\[[^\]]*\]/g, '').trim().length > 0;
        }).join('\n');
        try { fs.unlinkSync(txtFile); } catch {}
      }

      const problemTitle = parseProblemTitle(problemUrl);
      await Transcript.create({
        sessionId,
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
app.get("/transcripts", async (req, res) => {
  try {
    const transcripts = await Transcript.find({})
      .sort({ createdAt: -1 })
      .select("sessionId problemTitle problemLink audioTranscript createdAt");
    res.json({ transcripts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get single transcript (protected, must belong to user) ────────────────────
app.get("/transcripts/:id", async (req, res) => {
  try {
    const transcript = await Transcript.findById(req.params.id);
    if (!transcript) return res.status(404).json({ error: "Not found" });
    res.json({ transcript });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Delete transcript (protected, must belong to user) ────────────────────────
app.delete("/transcripts/:id", async (req, res) => {
  try {
    const transcript = await Transcript.findByIdAndDelete(req.params.id);
    if (!transcript) return res.status(404).json({ error: "Not found" });
    
    if (transcript.sessionId) {
      const audioFile = path.join(AUDIO_DIR, `${transcript.sessionId}.webm`);
      try { fs.unlinkSync(audioFile); } catch {}
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port", PORT);
});
