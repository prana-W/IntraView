import "dotenv/config";
import express         from "express";
import cors            from "cors";
import mongoose        from "mongoose";
import fs              from "fs";
import path            from "path";
import http            from "http";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";
import { Worker } from "worker_threads";

import Transcript      from "./models/Transcript.js";
import { InterviewSession } from "./interviewEngine.js";
import cfg             from "./interview.config.js";

const __dirname       = path.dirname(fileURLToPath(import.meta.url));
const PORT            = process.env.PORT || 8765;
const TRANSCRIPTS_DIR = path.join(__dirname, "transcripts");
const AUDIO_DIR       = path.join(__dirname, "audio");

for (const dir of [TRANSCRIPTS_DIR, AUDIO_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}


await mongoose.connect(process.env.MONGO_URI);
console.log(`✅ MongoDB connected: ${process.env.MONGO_URI}\n`);

console.log("⏳ Spawning transcription worker thread...");
console.log("ℹ️  Note: If this is the first run, it may take 10+ minutes to download the model (~1 GB) depending on your internet connection.\n");

const worker = new Worker(path.join(__dirname, "transcriptionWorker.js"));
const pendingTasks = new Map();
let taskIdCounter = 0;

worker.on("message", (msg) => {
  if (msg.type === "ready") {
    console.log("✅ Whisper model ready (in worker thread)!\n");
  } else if (msg.type === "result" || msg.type === "error") {
    const p = pendingTasks.get(msg.id);
    if (p) {
      if (msg.type === "result") p.resolve(msg.text);
      else p.reject(new Error(msg.error));
      pendingTasks.delete(msg.id);
    }
  }
});

function transcribeInWorker(samples) {
  return new Promise((resolve, reject) => {
    const id = taskIdCounter++;
    pendingTasks.set(id, { resolve, reject });
    // Transfer the underlying ArrayBuffer to the worker to avoid memory duplication
    worker.postMessage({ type: "transcribe", id, samples }, [samples.buffer]);
  });
}

class AsyncQueue {
  constructor() {
    this.queue = Promise.resolve();
  }
  enqueue(task) {
    return new Promise((resolve, reject) => {
      this.queue = this.queue.then(() => task().then(resolve).catch(reject));
    });
  }
}
const transcriptionQueue = new AsyncQueue();


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
  const totalSeconds = idx * 30;
  const h = Math.floor(totalSeconds / 3600).toString().padStart(2, "0");
  const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, "0");
  const s = (totalSeconds % 60).toString().padStart(2, "0");
  const stamp = `${h}:${m}:${s}`;
  fs.appendFileSync(tempTxtPath(sessionId), `[${stamp}] ${text}\n`, "utf8");
}


// ── Active interview sessions (keyed by sessionId) ───────────────────────────
const activeSessions = new Map(); // sessionId → InterviewSession


const app = express();

app.use(cors({
  origin: "*",          
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Session-Id", "X-Chunk-Index",
                   "X-Problem-Url", "X-Recording-Done", "X-Code-Snapshot", "X-Problem-Description"],
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
    const audioFile = path.join(AUDIO_DIR, `${sessionId}.wav`);
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

    const sessionId    = (req.headers["x-session-id"]   ?? "unknown").slice(0, 40);
    const chunkIndex   = String(req.headers["x-chunk-index"] ?? "0").padStart(3, "0");
    const problemUrl   = req.headers["x-problem-url"]  ?? "";
    const isDone       = req.headers["x-recording-done"] === "true";
    // Decode accepted code snapshot — only present on final chunk if user got Accepted
    const codeSnapshot = isDone && req.headers["x-code-snapshot"]
      ? Buffer.from(req.headers["x-code-snapshot"], "base64").toString("utf8")
      : "";
    // Decode problem description — captured at recording-start from LeetCode's description div
    const problemDescription = isDone && req.headers["x-problem-description"]
      ? Buffer.from(req.headers["x-problem-description"], "base64").toString("utf8")
      : "";

    // Enqueue transcription to avoid concurrent Whisper model executions
    const { transcript, done } = await transcriptionQueue.enqueue(async () => {
      // Save raw audio file
      const now      = new Date();
      const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
      const timePart = now.toTimeString().slice(0, 8).replace(/:/g, "");
      const audioFile = path.join(AUDIO_DIR, `${datePart}-${timePart}-chunk-${chunkIndex}.wav`);
      fs.writeFileSync(audioFile, audioBuf);
      console.log(`[+] Chunk ${chunkIndex} | ${(audioBuf.length/1024).toFixed(1)} KB`);

      // Transcribe
      const samples  = decodeWAV(audioBuf);
      let transcriptText = "";
      if (samples.length > 0) {
        console.log(`    Transcribing chunk ${chunkIndex} (via worker)…`);
        transcriptText = await transcribeInWorker(samples);
        console.log(`    → "${transcriptText}"`);
      } else {
        console.log(`    (Empty chunk ${chunkIndex} skipped transcription)`);
      }

      // Append to per-session temp file
      if (transcriptText) appendToTemp(sessionId, chunkIndex, transcriptText);

      // ── Feed transcript into the active interview session ──────────────────
      const session = activeSessions.get(sessionId);
      if (session && transcriptText) {
        session.addTranscriptChunk(transcriptText);

        // If accepted code arrives mid-session, inform the engine
        if (codeSnapshot && !session._codeDelivered) {
          session._codeDelivered = true;
          session._pendingCode   = codeSnapshot;
          console.log(`    📄 Code snapshot delivered to interview session ${sessionId}`);
        }
      }

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
        if (codeSnapshot) {
          console.log(`    📄 Accepted code snapshot received (${codeSnapshot.length} chars)`);
        }

        // If there is an active interview session, let it handle the DB save
        const activeSession = activeSessions.get(sessionId);
        if (activeSession) {
          // The session will be ended via WS "end_interview" message.
          // We just store the audioTranscript + codeSnapshot here for completeness.
          // The session.end() will upsert with interviewTurns when the WS message arrives.
          await Transcript.findOneAndUpdate(
            { sessionId },
            {
              $set: {
                sessionId,
                problemTitle,
                problemLink:     problemUrl,
                audioTranscript: fullText,
                codeSnapshot,
                problemDescription,
              },
            },
            { upsert: true, new: true }
          );
          console.log(`    ✅ Audio transcript upserted for interview session ${sessionId}`);
        } else {
          // Legacy (non-interview) mode — save as before
          await Transcript.create({
            sessionId,
            problemTitle,
            problemLink:        problemUrl,
            audioTranscript:    fullText,
            codeSnapshot,
            problemDescription,
          });
          console.log(`    ✅ Transcript saved to MongoDB (problem: ${problemTitle})\n`);
        }
      }
      
      return { transcript: transcriptText, done: isDone };
    });

    res.json({ transcript, done });
  } catch (err) {
    console.error("[!] Transcription error:", err.message);
    res.status(500).json({ error: err.message });
  }
});


// ── Get all transcripts for the user ─────────────────────────────────────────
app.get("/transcripts", async (req, res) => {
  try {
    const transcripts = await Transcript.find({})
      .sort({ createdAt: -1 })
      .select("sessionId problemTitle problemLink audioTranscript codeSnapshot problemDescription interviewTurns interviewSummary createdAt");
    res.json({ transcripts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get single transcript ─────────────────────────────────────────────────────
app.get("/transcripts/:id", async (req, res) => {
  try {
    const transcript = await Transcript.findById(req.params.id);
    if (!transcript) return res.status(404).json({ error: "Not found" });
    res.json({ transcript });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Delete transcript ─────────────────────────────────────────────────────────
app.delete("/transcripts/:id", async (req, res) => {
  try {
    const transcript = await Transcript.findByIdAndDelete(req.params.id);
    if (!transcript) return res.status(404).json({ error: "Not found" });
    
    if (transcript.sessionId) {
      const audioFileWav = path.join(AUDIO_DIR, `${transcript.sessionId}.wav`);
      const audioFileWebm = path.join(AUDIO_DIR, `${transcript.sessionId}.webm`);
      try { fs.unlinkSync(audioFileWav); } catch {}
      try { fs.unlinkSync(audioFileWebm); } catch {}
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Delete all transcripts ────────────────────────────────────────────────────
app.delete("/transcripts", async (req, res) => {
  try {
    const transcripts = await Transcript.find({});
    for (const transcript of transcripts) {
      if (transcript.sessionId) {
        const audioFileWav = path.join(AUDIO_DIR, `${transcript.sessionId}.wav`);
        const audioFileWebm = path.join(AUDIO_DIR, `${transcript.sessionId}.webm`);
        try { fs.unlinkSync(audioFileWav); } catch {}
        try { fs.unlinkSync(audioFileWebm); } catch {}
      }
    }
    await Transcript.deleteMany({});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── HTTP server (shared between Express and WebSocket) ───────────────────────
const httpServer = http.createServer(app);

// ── WebSocket server ──────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
  console.log("[WS] Client connected");
  let boundSessionId = null;

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      // ── Extension clicked "IntraView" ──────────────────────────────────────
      case "start_interview": {
        const { sessionId, pageContent } = msg;
        if (!sessionId || !pageContent) {
          ws.send(JSON.stringify({ type: "error", message: "sessionId and pageContent required" }));
          return;
        }

        boundSessionId = sessionId;
        console.log(`[WS] Starting interview session: ${sessionId}`);

        const session = new InterviewSession(sessionId, ws);
        activeSessions.set(sessionId, session);

        // Fire-and-forget — responses sent via WebSocket inside session.start()
        session.start(pageContent).catch(err =>
          console.error("[WS] session.start error:", err.message)
        );
        break;
      }

      // ── User clicked "➜ Next" ──────────────────────────────────────────────
      case "next_turn": {
        const session = activeSessions.get(msg.sessionId ?? boundSessionId);
        if (!session) {
          ws.send(JSON.stringify({ type: "error", message: "No active session" }));
          return;
        }
        session.onNextClicked().catch(err =>
          console.error("[WS] onNextClicked error:", err.message)
        );
        break;
      }

      // ── User clicked "End Interview" ───────────────────────────────────────
      case "end_interview": {
        const sid = msg.sessionId ?? boundSessionId;
        const session = activeSessions.get(sid);
        if (!session) return;

        session.end(async (sessionId, interviewTurns, interviewSummary) => {
          await Transcript.findOneAndUpdate(
            { sessionId },
            { $set: { interviewTurns, interviewSummary } },
            { upsert: true }
          );
        }).catch(err => console.error("[WS] session.end error:", err.message));

        activeSessions.delete(sid);
        break;
      }

      case "ping":
        ws.send(JSON.stringify({ type: "pong" }));
        break;
    }
  });

  ws.on("close", () => {
    console.log(`[WS] Client disconnected (session: ${boundSessionId ?? "none"})`);
    // Clean up session if connection drops unexpectedly
    if (boundSessionId) {
      const session = activeSessions.get(boundSessionId);
      if (session && !session.ended) {
        session._stopHintTimer?.();
      }
      activeSessions.delete(boundSessionId);
    }
  });

  ws.on("error", (err) => console.error("[WS] Error:", err.message));
});


httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket ready at ws://localhost:${PORT}`);
});
