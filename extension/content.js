/**
 * IntraView – Content Script (UI + Audio Recorder)
 *
 * Flow:
 *  1. Click Record → getUserMedia → MediaRecorder starts
 *  2. Click Stop   → stop MediaRecorder → encode chunks to WAV
 *  3. POST WAV to http://localhost:8765/transcribe
 *  4. Server transcribes + saves; we show the result in a toast
 */
(function () {
  "use strict";

  const SERVER   = "http://localhost:8765";
  const BTN_ID   = "intraview-record-btn";
  const TOAST_ID = "intraview-toast";
  const DOT_ID   = "intraview-indicator";

  let isRecording  = false;
  let mediaRecorder = null;
  let audioChunks  = [];

  // ── WAV encoder (pure JS, no deps) ─────────────────────────────────────────
  function encodeWAV(samples, sampleRate) {
    const dataLen = samples.length * 2;
    const buf = new ArrayBuffer(44 + dataLen);
    const v   = new DataView(buf);
    const str = (off, s) => [...s].forEach((c, i) => v.setUint8(off + i, c.charCodeAt(0)));
    str(0, "RIFF"); v.setUint32(4, 36 + dataLen, true);
    str(8, "WAVE"); str(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true);   // PCM
    v.setUint16(22, 1, true);                                // mono
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, "data"); v.setUint32(40, dataLen, true);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return buf;
  }

  async function blobToWav(blob) {
    const arrayBuf = await blob.arrayBuffer();
    const ctx      = new AudioContext();
    const audioBuf = await ctx.decodeAudioData(arrayBuf);
    // Resample to 16 kHz (Whisper requirement)
    const TARGET_SR = 16000;
    const offline   = new OfflineAudioContext(1, Math.ceil(audioBuf.duration * TARGET_SR), TARGET_SR);
    const src       = offline.createBufferSource();
    src.buffer      = audioBuf;
    src.connect(offline.destination);
    src.start();
    const resampled = await offline.startRendering();
    const samples   = resampled.getChannelData(0);
    return new Blob([encodeWAV(samples, TARGET_SR)], { type: "audio/wav" });
  }

  // ── Recording ───────────────────────────────────────────────────────────────
  async function startRecording() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      showToast("❌ Mic access denied.", "error"); return;
    }

    audioChunks  = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = handleStop;
    mediaRecorder.start(250); // collect chunks every 250 ms

    isRecording = true;
    updateButton();
    setDot(true);
    showToast("🎙️ Recording… click Stop when done.", "success");
  }

  async function stopRecording() {
    if (!mediaRecorder) return;
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach(t => t.stop());
  }

  async function handleStop() {
    isRecording = false;
    updateButton();
    setDot(false);
    showToast("⏳ Processing audio…", "info");

    try {
      const rawBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
      const wavBlob = await blobToWav(rawBlob);

      const res  = await fetch(`${SERVER}/transcribe`, {
        method:  "POST",
        headers: { "Content-Type": "audio/wav" },
        body:    wavBlob,
      });

      if (!res.ok) throw new Error(`Server ${res.status}`);
      const { transcript, saved } = await res.json();
      const preview = transcript.length > 60 ? transcript.slice(0, 60) + "…" : transcript;
      showToast(`✅ Saved to ${saved}: "${preview}"`, "success");
    } catch (err) {
      console.error("[IntraView] Upload error:", err);
      showToast(`❌ Error: ${err.message}`, "error");
    }

    audioChunks  = [];
    mediaRecorder = null;
  }

  function toggleRecording() {
    if (isRecording) stopRecording();
    else             startRecording();
  }

  // ── UI ──────────────────────────────────────────────────────────────────────
  function updateButton() {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    if (isRecording) {
      btn.classList.add("iv-recording");
      btn.title = "Stop recording";
      btn.querySelector(".iv-btn-label").textContent = "Stop";
      btn.querySelector(".iv-btn-icon").textContent  = "⏹";
    } else {
      btn.classList.remove("iv-recording");
      btn.title = "Start voice recording";
      btn.querySelector(".iv-btn-label").textContent = "Record";
      btn.querySelector(".iv-btn-icon").textContent  = "🎙";
    }
  }

  function setDot(on) {
    const d = document.getElementById(DOT_ID);
    if (d) d.style.display = on ? "block" : "none";
  }

  function createButton() {
    if (document.getElementById(BTN_ID)) return;
    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.title = "Start voice recording";
    btn.innerHTML = `
      <span class="iv-btn-icon">🎙</span>
      <span class="iv-btn-label">Record</span>
      <span id="${DOT_ID}" class="iv-pulse-dot" style="display:none;"></span>
    `;
    btn.addEventListener("click", toggleRecording);
    injectIntoPage(btn);
  }

  function injectIntoPage(btn) {
    const selectors = ["nav","[class*='NavBar']","[class*='header']","header","#__next nav"];
    for (const sel of selectors) {
      const target = document.querySelector(sel);
      if (target) {
        const w = document.createElement("div");
        w.className = "iv-wrapper";
        w.appendChild(btn);
        target.appendChild(w);
        return;
      }
    }
    btn.classList.add("iv-floating");
    document.body.appendChild(btn);
  }

  function showToast(message, type = "info") {
    let t = document.getElementById(TOAST_ID);
    if (!t) { t = document.createElement("div"); t.id = TOAST_ID; document.body.appendChild(t); }
    t.className   = `iv-toast iv-toast-${type} iv-toast-enter`;
    t.textContent = message;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => {
      t.classList.add("iv-toast-exit");
      setTimeout(() => { t.textContent = ""; t.className = "iv-toast"; }, 400);
    }, 4000);
  }

  // ── Init ────────────────────────────────────────────────────────────────────
  function tryInject() {
    if (document.getElementById(BTN_ID)) return;
    if (document.querySelector("nav, header, [class*='NavBar']")) createButton();
  }

  new MutationObserver(tryInject).observe(document.body, { childList: true, subtree: true });
  tryInject();

  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) { lastHref = location.href; setTimeout(tryInject, 800); }
  }, 500);
})();
