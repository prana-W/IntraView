import http from "http";
import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pipeline, env } from "@xenova/transformers";

const __dirname       = path.dirname(fileURLToPath(import.meta.url));
const PORT            = 8765;
const TRANSCRIPTS_DIR = path.join(__dirname, "transcripts");
const AUDIO_DIR       = path.join(__dirname, "audio");


for (const dir of [TRANSCRIPTS_DIR, AUDIO_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function todayStr() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`;
}

function appendTranscript(text) {
  const file  = path.join(TRANSCRIPTS_DIR, `${todayStr()}.txt`);
  const stamp = new Date().toLocaleTimeString("en-IN", { hour12: false });
  fs.appendFileSync(file, `[${stamp}] ${text}\n`, "utf8");
  return path.basename(file);
}

/** Decode a 16-bit PCM WAV Buffer → Float32Array */
function decodeWAV(buf) {
  const view       = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const numSamples = (buf.byteLength - 44) / 2;
  const out        = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    out[i] = view.getInt16(44 + i * 2, true) / 32768;
  }
  return out;
}

// ── CORS helper ───────────────────────────────────────────────────────────────
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// ── Load Whisper model ────────────────────────────────────────────────────────
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

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  cors(res);

  // Preflight
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  // Transcription endpoint
  if (req.method === "POST" && req.url === "/transcribe") {
    const rawChunks = [];
    req.on("data", c => rawChunks.push(c));
    req.on("end", async () => {
      try {
        const audioBuf   = Buffer.concat(rawChunks);
        const sessionId  = (req.headers["x-session-id"]  ?? "unknown").slice(0, 30);
        const chunkIndex = String(req.headers["x-chunk-index"] ?? "0").padStart(3, "0");

        // Save chunk audio: YYYYMMDD-HHMMSS-session-chunk-NNN.wav
        const now      = new Date();
        const datePart = todayStr().replace(/-/g, "");
        const timePart = now.toTimeString().slice(0, 8).replace(/:/g, "");
        const audioFileName = `${datePart}-${timePart}-chunk-${chunkIndex}.wav`;
        const audioFile     = path.join(AUDIO_DIR, audioFileName);
        fs.writeFileSync(audioFile, audioBuf);
        console.log(`[+] Chunk ${chunkIndex} saved: ${audioFileName} (${(audioBuf.length/1024).toFixed(1)} KB)`);

        // Decode WAV → Float32 samples
        const samples = decodeWAV(audioBuf);

        // Transcribe with Whisper
        console.log(`    Transcribing chunk ${chunkIndex}…`);
        const result = await transcriber(samples, { sampling_rate: 16000 });
        const transcript = (result?.text ?? "").trim();
        console.log(`    → "${transcript}"`);

        // Save transcript
        const saved = appendTranscript(transcript);
        console.log(`    Appended to ${saved}\n`);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ transcript, saved }));
      } catch (err) {
        console.error("[!] Transcription error:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, () => {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   IntraView – Transcript Server Running      ║");
  console.log(`║   POST http://localhost:${PORT}/transcribe     ║`);
  console.log(`║   GET  http://localhost:${PORT}/health         ║`);
  console.log("╚══════════════════════════════════════════════╝\n");
  console.log("Waiting for recordings…\n");
});
