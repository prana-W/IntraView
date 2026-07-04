"use strict";

let recognition = null;
let isRecording = false;
let micStream   = null;



function send(payload) {
  chrome.runtime.sendMessage(payload).catch(() => {});
}



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
