
const WS_URL = "ws://localhost:8765/";

let ws          = null;
let activeTabId = null;


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



function openWebSocket(onReady) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    onReady?.();
    return;
  }

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log("[IntraView BG] WebSocket open");
    onReady?.();
  };

  // ── Route server → extension messages to the active tab ───────────────────
  ws.onmessage = (event) => {
    if (!activeTabId) return;
    try {
      const msg = JSON.parse(event.data);
      // Forward AI interview messages to the content script
      if (["ai_question", "ai_hint", "thinking", "interview_done", "error"].includes(msg.type)) {
        chrome.tabs.sendMessage(activeTabId, { action: "interview_msg", payload: msg }).catch(() => {});
      }
    } catch {}
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
    ws.close();
  }
  ws = null;
}

function sendToServer(payload) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action } = message;


  if (action === "start") {
    activeTabId = sender.tab?.id;

    openWebSocket(async () => {
      try {
        await ensureOffscreenDocument();
        chrome.runtime.sendMessage({ action: "startRecognition" }).catch(() => {});
      } catch (err) {
        console.error("[IntraView BG] Offscreen error:", err);
      }
    });

    sendResponse({ ok: true });
    return true;
  }


  if (action === "stop") {
    chrome.runtime.sendMessage({ action: "stopRecognition" }).catch(async () => {
      await destroyOffscreenDocument();
    });
    closeWebSocket();
    sendResponse({ ok: true });
    return true;
  }


  if (action === "transcript") {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "transcript", transcript: message.text }));
    }
    sendResponse({ ok: true });
    return true;
  }


  if (action === "recognitionStopped") {
    destroyOffscreenDocument().catch(() => {});
    sendResponse({ ok: true });
    return true;
  }


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

  // ── Interview mode messages (content.js → server via background) ───────────

  if (action === "start_interview") {
    activeTabId = sender.tab?.id;
    openWebSocket(() => {
      sendToServer({ type: "start_interview", sessionId: message.sessionId, pageContent: message.pageContent });
    });
    sendResponse({ ok: true });
    return true;
  }

  if (action === "next_turn") {
    sendToServer({ type: "next_turn", sessionId: message.sessionId });
    sendResponse({ ok: true });
    return true;
  }

  if (action === "end_interview") {
    sendToServer({ type: "end_interview", sessionId: message.sessionId });
    closeWebSocket();
    sendResponse({ ok: true });
    return true;
  }

  return false;
});
