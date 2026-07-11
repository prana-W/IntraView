/**
 * ollamaClient.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Thin HTTP wrapper around Ollama's /api/chat endpoint.
 * Returns a parsed { question, is_hint, next_stage } object.
 */

import cfg from "./interview.config.js";

/**
 * Send a multi-turn conversation to Ollama and parse the JSON response.
 * @param {Array<{role:string, content:string}>} messages  - Full conversation history
 * @returns {Promise<{question:string, is_hint:boolean, next_stage:string}>}
 */
export async function chat(messages) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.OLLAMA_TIMEOUT_MS);

  try {
    const res = await fetch(`${cfg.OLLAMA_BASE_URL}/api/chat`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      signal:  controller.signal,
      body: JSON.stringify({
        model:  cfg.OLLAMA_MODEL,
        stream: false,
        messages,
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    const raw  = data?.message?.content ?? "";

    // Parse the JSON block from Ollama's response
    return parseOllamaResponse(raw);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract the JSON object from Ollama's response text.
 * Handles cases where the model wraps JSON in markdown code fences.
 */
function parseOllamaResponse(raw) {
  // Strip markdown code fences if present
  let text = raw.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) text = fenceMatch[1].trim();

  // Find the first { ... } block
  const braceStart = text.indexOf("{");
  const braceEnd   = text.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd !== -1) {
    text = text.slice(braceStart, braceEnd + 1);
  }

  try {
    const parsed = JSON.parse(text);
    return {
      question:   String(parsed.question   ?? "Can you elaborate on that?"),
      is_hint:    Boolean(parsed.is_hint   ?? false),
      next_stage: String(parsed.next_stage ?? ""),
    };
  } catch {
    // Fallback: treat entire response as the question
    console.warn("[Ollama] Failed to parse JSON response, using raw text.");
    return {
      question:   raw.trim() || "Can you elaborate on that?",
      is_hint:    false,
      next_stage: "",
    };
  }
}

/**
 * Build the initial message array for a new interview session.
 * @param {string} stage        - Current stage name e.g. "INTRO"
 * @param {string} pageContent  - Scraped problem text from LeetCode
 */
export function buildStartMessages(stage, pageContent) {
  return [
    { role: "system", content: cfg.SYSTEM_PROMPT },
    {
      role: "user",
      content: `[INTERVIEW START]
Stage: ${stage}
Problem context:
---
${pageContent.slice(0, 4000)}
---
Begin the interview. Ask your first question for the ${stage} stage.`,
    },
  ];
}

/**
 * Build the hint request message.
 * @param {string} stage              - Current stage name
 * @param {Array}  conversationHistory - Existing history
 */
export function buildHintMessages(stage, conversationHistory) {
  return [
    ...conversationHistory,
    {
      role: "user",
      content: `[SYSTEM: The candidate has been silent for over 45 seconds during the ${stage} stage. Provide a small, relevant hint to help them progress. Set "is_hint": true in your response. Do NOT advance the stage.]`,
    },
  ];
}

/**
 * Build the "user responded, now what?" message.
 * @param {string} userTranscript     - Accumulated transcript for this turn
 * @param {string} stage              - Current stage name
 * @param {Array}  conversationHistory - Existing history
 */
export function buildUserTurnMessages(userTranscript, stage, conversationHistory) {
  return [
    ...conversationHistory,
    {
      role: "user",
      content: `[Stage: ${stage}] Candidate's response: "${userTranscript}"

Evaluate their response. Ask a follow-up or advance to the next stage if they've addressed ${stage} sufficiently. Set next_stage accordingly.`,
    },
  ];
}
