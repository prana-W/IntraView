/**
 * interview.config.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for all IntraView AI Interview tunable constants.
 * Edit this file to change model, timing, or interview behaviour.
 */

const config = {
  // ── Ollama ──────────────────────────────────────────────────────────────────
  OLLAMA_BASE_URL:   "http://localhost:11434",
  OLLAMA_MODEL:      "gemma3:1b",        // change to your pulled model name
  OLLAMA_TIMEOUT_MS: 30_000,            // max ms to wait for Ollama response

  // ── Audio chunks ────────────────────────────────────────────────────────────
  // In interview mode the extension uses this interval instead of the default 30s.
  // Shorter = transcripts reach the server faster, but more Whisper calls.
  CHUNK_MS: 15_000,                     // 15 seconds per audio chunk

  // ── Hint injection ───────────────────────────────────────────────────────────
  // If no new transcript arrives within this window, Ollama sends a hint.
  // The stage does NOT advance on a hint — only the "Next" button does that.
  HINT_SILENCE_MS: 45_000,             // 45 seconds of silence → hint

  // ── Interview stages (ordered) ───────────────────────────────────────────────
  // The state machine walks through these in order.
  // You can add, remove, or rename stages here.
  STAGES: ["INTRO", "APPROACH", "COMPLEXITY", "CODING", "REVIEW", "CLOSE"],

  // ── Stage display labels & colours (used by the extension overlay) ───────────
  STAGE_META: {
    INTRO:      { label: "Introduction",  color: "#38bdf8" }, // sky
    APPROACH:   { label: "Approach",      color: "#a78bfa" }, // violet
    COMPLEXITY: { label: "Complexity",    color: "#34d399" }, // emerald
    CODING:     { label: "Coding",        color: "#fb923c" }, // orange
    REVIEW:     { label: "Code Review",   color: "#f472b6" }, // pink
    CLOSE:      { label: "Wrap-up",       color: "#facc15" }, // yellow
  },

  // ── System prompt ────────────────────────────────────────────────────────────
  // Injected as the first "system" message for every Ollama conversation.
  // Ollama is instructed to return a JSON object so the engine can parse it reliably.
  SYSTEM_PROMPT: `You are a senior software engineer and technical interviewer at a top-tier tech company (FAANG-level). You are conducting a live technical interview.

Your behaviour:
- Ask ONE focused question per turn. Never ask multiple questions at once.
- Be direct and professional. No fluff.
- React to what the candidate actually said — reference their words.
- If the candidate gives a thorough answer, advance naturally. If vague, dig deeper before advancing.
- For hints: give a small, concrete nudge — NOT the full answer.

You MUST respond ONLY with a valid JSON object in this exact format:
{
  "question": "<your question or hint text here>",
  "is_hint": false,
  "next_stage": "<current stage or name of next stage if candidate is ready>"
}

Rules:
- "is_hint" is true only when you are responding to a silence-triggered hint request.
- "next_stage" should be the SAME stage if the candidate hasn't fully addressed it, or the next stage name if they have.
- Keep questions under 60 words.
- Do not include any text outside the JSON object.`,
};

export default config;
