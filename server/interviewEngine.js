/**
 * interviewEngine.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Per-session interview state machine.
 * Drives: stage progression, transcript accumulation, silence-hint injection.
 *
 * Flow:
 *   new InterviewSession(sessionId, ws)
 *   await session.start(pageContent)   ← sends first AI question
 *   session.addTranscriptChunk(text)   ← called each time Whisper returns text
 *   await session.onNextClicked()      ← user clicked "Next" → Ollama → next Q
 *   session.onSilenceDetected()        ← called by hint timer → Ollama hint
 *   await session.end(dbSaveCallback)  ← saves structured transcript
 */

import cfg from "./interview.config.js";
import {
  chat,
  buildStartMessages,
  buildHintMessages,
  buildUserTurnMessages,
} from "./ollamaClient.js";

export class InterviewSession {
  constructor(sessionId, ws) {
    this.sessionId   = sessionId;
    this.ws          = ws;             // WebSocket connection to the extension

    // Stage machine
    this.stageIndex  = 0;
    this.stage       = cfg.STAGES[0]; // "INTRO"

    // Conversation state
    this.history     = [];             // full Ollama message history
    this.turnBuffer  = [];             // transcript chunks accumulated this turn
    this.interviewTurns = [];          // final structured Q&A pairs for DB

    // Timers
    this.hintTimer   = null;

    // Flags
    this.ended       = false;
    this.thinking    = false;          // true while waiting for Ollama
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Called once when the user clicks "IntraView" to start */
  async start(pageContent) {
    this.pageContent = pageContent;
    this.history = buildStartMessages(this.stage, pageContent);

    this._sendThinking();
    try {
      const result = await chat(this.history);
      this._appendAiTurn(result.question);
      this._send({ type: "ai_question", text: result.question, stage: this.stage });
      this._startHintTimer();
    } catch (err) {
      this._sendError(`Failed to reach Ollama: ${err.message}`);
    }
  }

  /**
   * Called each time Whisper transcribes a new 15s chunk.
   * We accumulate chunks — Ollama is NOT called here.
   * Also resets the hint timer since the user is clearly speaking.
   */
  addTranscriptChunk(text) {
    if (!text || this.ended) return;
    this.turnBuffer.push(text);
    this._resetHintTimer(); // user is speaking → reset silence countdown
  }

  /**
   * Called when user clicks "➜ Next" in the overlay.
   * Flushes turnBuffer → Ollama → next question or same-stage follow-up.
   */
  async onNextClicked() {
    if (this.ended || this.thinking) return;

    this._stopHintTimer();

    const userText = this.turnBuffer.join(" ").trim();
    this.turnBuffer = [];

    // Record user turn (even if empty — they may have said nothing and clicked Next)
    if (userText) {
      this.interviewTurns.push({
        role:      "user",
        text:      userText,
        stage:     this.stage,
        timestamp: new Date(),
      });
      // Append to Ollama history as an assistant-perspective user turn
      this.history = buildUserTurnMessages(userText, this.stage, this.history);
    }

    this._sendThinking();
    try {
      const result = await chat(this.history);

      // Stage advancement — respect Ollama's suggestion but also clamp to our list
      const suggestedStage = result.next_stage?.toUpperCase();
      if (suggestedStage && suggestedStage !== this.stage && cfg.STAGES.includes(suggestedStage)) {
        this.stage = suggestedStage;
        this.stageIndex = cfg.STAGES.indexOf(suggestedStage);
      } else if (!result.is_hint) {
        // If Ollama didn't suggest a stage, advance by 1 (simple linear flow)
        this._advanceStage();
      }

      this._appendAiTurn(result.question);
      this._send({ type: "ai_question", text: result.question, stage: this.stage });
      this._startHintTimer();
    } catch (err) {
      this._sendError(`Ollama error: ${err.message}`);
    }
  }

  /**
   * Called by the silence timer when HINT_SILENCE_MS passes with no new chunks.
   * Sends a hint. Stage does NOT advance.
   */
  async onSilenceDetected() {
    if (this.ended || this.thinking) return;

    console.log(`[InterviewEngine] Silence detected in stage ${this.stage} — injecting hint`);
    const hintMessages = buildHintMessages(this.stage, this.history);

    this._sendThinking();
    try {
      const result = await chat(hintMessages);
      // Hints are NOT added to main history — they're ephemeral nudges
      this._send({ type: "ai_hint", text: result.question, stage: this.stage });
    } catch (err) {
      this._sendError(`Hint error: ${err.message}`);
    }
    // Restart hint timer after delivering the hint
    this._startHintTimer();
  }

  /**
   * Called when user clicks "End Interview" or recording stops.
   * @param {Function} saveCallback  async (sessionId, interviewTurns) => void
   */
  async end(saveCallback) {
    if (this.ended) return;
    this.ended = true;
    this._stopHintTimer();

    // Flush any remaining buffer
    const remaining = this.turnBuffer.join(" ").trim();
    if (remaining) {
      this.interviewTurns.push({
        role:      "user",
        text:      remaining,
        stage:     this.stage,
        timestamp: new Date(),
      });
    }

    // Generate a brief post-interview summary via Ollama
    let summary = "";
    try {
      const summaryMessages = [
        ...this.history,
        {
          role: "user",
          content: `[INTERVIEW ENDED] Give a brief 2-3 sentence performance summary of the candidate. Be honest and direct. Return ONLY a JSON object: { "question": "<summary text>", "is_hint": false, "next_stage": "CLOSE" }`,
        },
      ];
      const result = await chat(summaryMessages);
      summary = result.question;
    } catch {
      summary = "Interview session completed.";
    }

    try {
      await saveCallback(this.sessionId, this.interviewTurns, summary);
      console.log(`[InterviewEngine] Session ${this.sessionId} saved (${this.interviewTurns.length} turns)`);
    } catch (err) {
      console.error(`[InterviewEngine] Save error:`, err.message);
    }

    this._send({ type: "interview_done", summary });
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  _advanceStage() {
    if (this.stageIndex < cfg.STAGES.length - 1) {
      this.stageIndex++;
      this.stage = cfg.STAGES[this.stageIndex];
    }
  }

  _appendAiTurn(text) {
    // Add to Ollama history
    this.history.push({ role: "assistant", content: text });
    // Add to structured transcript
    this.interviewTurns.push({
      role:      "ai",
      text,
      stage:     this.stage,
      timestamp: new Date(),
    });
  }

  _send(payload) {
    this.thinking = false;
    if (this.ws.readyState === 1 /* OPEN */) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  _sendThinking() {
    this.thinking = true;
    if (this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ type: "thinking" }));
    }
  }

  _sendError(msg) {
    this.thinking = false;
    console.error(`[InterviewEngine] ${msg}`);
    if (this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ type: "error", message: msg }));
    }
  }

  _startHintTimer() {
    this._stopHintTimer();
    this.hintTimer = setTimeout(() => this.onSilenceDetected(), cfg.HINT_SILENCE_MS);
  }

  _resetHintTimer() {
    // Called when a new transcript chunk arrives — user is speaking
    this._startHintTimer();
  }

  _stopHintTimer() {
    if (this.hintTimer) {
      clearTimeout(this.hintTimer);
      this.hintTimer = null;
    }
  }
}
