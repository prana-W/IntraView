/**
 * IntraView – Offscreen Script
 *
 * Runs inside offscreen.html (a real extension page context).
 * This is the ONLY place Web Speech API works reliably in MV3.
 *
 * Message flow:
 *   background → {action:"startRecognition"} → starts SpeechRecognition
 *   background → {action:"stopRecognition"}  → stops cleanly
 *   here → {action:"transcript",  text}      → background → WS server
 *   here → {action:"recognitionError", error}→ background → content.js
 *   here → {action:"recognitionStopped"}     → background tears down
 */

"use strict";

let recognition = null;
let isRecording = false;
let micStream   = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function send(payload) {
  chrome.runtime.sendMessage(payload).catch(() => {});
}

// ─── Speech Recognition ───────────────────────────────────────────────────────

async function startRecognition() {
  // Request mic explicitly so Chrome registers permission before SpeechRecognition
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    send({ action: "recognitionError", error: "not-allowed" });
    return;
  }

  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    send({ action: "recognitionError", error: "not-supported" });
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous     = true;
  recognition.interimResults = true;
  recognition.lang           = "en-US";
  isRecording = true;

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        const text = event.results[i][0].transcript.trim();
        if (text) {
          send({ action: "transcript", text });
        }
      }
    }
  };

  recognition.onerror = (event) => {
    const err = event.error;
    // These fire normally; auto-restart will handle them
    if (err === "no-speech" || err === "aborted") return;
    console.error("[IntraView Offscreen] Recognition error:", err);
    send({ action: "recognitionError", error: err });
    isRecording = false;
  };

  recognition.onend = () => {
    if (isRecording) {
      // Browser stops on silence — restart immediately
      try { recognition.start(); } catch(e) {}
    } else {
      releaseMic();
      send({ action: "recognitionStopped" });
    }
  };

  recognition.start();
  console.log("[IntraView Offscreen] Recognition started");
}

function stopRecognition() {
  isRecording = false;
  if (recognition) {
    recognition.onend = () => {
      releaseMic();
      send({ action: "recognitionStopped" });
    };
    try { recognition.stop(); } catch(e) {
      releaseMic();
      send({ action: "recognitionStopped" });
    }
    recognition = null;
  } else {
    releaseMic();
    send({ action: "recognitionStopped" });
  }
}

function releaseMic() {
  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
  }
}

// ─── Message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "startRecognition") {
    startRecognition();
    sendResponse({ ok: true });
  } else if (message.action === "stopRecognition") {
    stopRecognition();
    sendResponse({ ok: true });
  }
  return true;
});
