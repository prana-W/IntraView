
const WS_URL = "ws://localhost:8765";

let ws          = null;
let activeTabId = null;

// ─── Offscreen document ───────────────────────────────────────────────────────

async function ensureOffscreenDocument() {
  const existing = await chrome.offscreen.hasDocument();
  if (!existing) {
    await chrome.offscreen.createDocument({
      url:           "offscreen.html",
      reasons:       ["USER_MEDIA"],
      justification: "Capture microphone audio for Web Speech API transcription",
    });
  }
}

async function destroyOffscreenDocument() {
  const existing = await chrome.offscreen.hasDocument();
  if (existing) {
    await chrome.offscreen.closeDocument();
  }
}

// ─── WebSocket ────────────────────────────────────────────────────────────────

function openWebSocket(onReady) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    onReady?.();
    return;
  }

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log("[IntraView BG] WebSocket open");
    ws.send(JSON.stringify({ type: "start" }));
    onReady?.();
  };

  ws.onerror = () => {
    console.error("[IntraView BG] WebSocket error – is the server running?");
    if (activeTabId) {
      chrome.tabs.sendMessage(activeTabId, {
        action: "error",
        error:  "server-unreachable",
      }).catch(() => {});
    }
  };

  ws.onclose = () => {
    console.log("[IntraView BG] WebSocket closed");
    ws = null;
  };
}

function closeWebSocket() {
  if (!ws) return;
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "stop" }));
    ws.close();
  }
  ws = null;
}

// ─── Message router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action } = message;

  // ── content.js → background: user clicked Record ──
  if (action === "start") {
    activeTabId = sender.tab?.id;

    openWebSocket(async () => {
      try {
        await ensureOffscreenDocument();
        // Tell offscreen doc to begin recognition
        chrome.runtime.sendMessage({ action: "startRecognition" }).catch(() => {});
      } catch (err) {
        console.error("[IntraView BG] Offscreen error:", err);
      }
    });

    sendResponse({ ok: true });
    return true;
  }

  // ── content.js → background: user clicked Stop ──
  if (action === "stop") {
    // Tell offscreen doc to stop, then tear down
    chrome.runtime.sendMessage({ action: "stopRecognition" }).catch(async () => {
      // Offscreen may already be gone
      await destroyOffscreenDocument();
    });
    closeWebSocket();
    sendResponse({ ok: true });
    return true;
  }

  // ── offscreen.js → background: a final transcript segment ──
  if (action === "transcript") {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "transcript", transcript: message.text }));
    }
    sendResponse({ ok: true });
    return true;
  }

  // ── offscreen.js → background: recognition stopped cleanly ──
  if (action === "recognitionStopped") {
    destroyOffscreenDocument().catch(() => {});
    sendResponse({ ok: true });
    return true;
  }

  // ── offscreen.js → background: recognition error ──
  if (action === "recognitionError") {
    console.error("[IntraView BG] Recognition error:", message.error);
    destroyOffscreenDocument().catch(() => {});
    closeWebSocket();
    if (activeTabId) {
      chrome.tabs.sendMessage(activeTabId, {
        action: "error",
        error:  message.error,
      }).catch(() => {});
    }
    sendResponse({ ok: true });
    return true;
  }

  return false;
});
