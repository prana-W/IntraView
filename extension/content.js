/**
 * IntraView – Content Script
 * Single continuous MediaRecorder, flushed every 10s via setInterval.
 */
(function () {
  "use strict";

  const SERVER   = "http://localhost:8765";
  const BTN_ID   = "intraview-record-btn";
  const TOAST_ID = "intraview-toast";
  const DOT_ID   = "intraview-indicator";
  const CHUNK_MS = 10_000;

  let isRecording  = false;
  let micStream    = null;
  let mediaRecorder = null;
  let pendingBufs  = [];   // raw data from ondataavailable
  let chunkIndex   = 0;
  let sessionId    = null;
  let flushTimer   = null;
  let mimeType     = "";

  // ── WAV encoder ─────────────────────────────────────────────────────────────
  function encodeWAV(samples, sr) {
    const len = samples.length * 2;
    const buf = new ArrayBuffer(44 + len);
    const v   = new DataView(buf);
    const s   = (o, t) => [...t].forEach((c,i) => v.setUint8(o+i, c.charCodeAt(0)));
    s(0,"RIFF"); v.setUint32(4,36+len,true); s(8,"WAVE"); s(12,"fmt ");
    v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true);
    v.setUint32(24,sr,true); v.setUint32(28,sr*2,true);
    v.setUint16(32,2,true);  v.setUint16(34,16,true);
    s(36,"data"); v.setUint32(40,len,true);
    for (let i=0; i<samples.length; i++) {
      const x = Math.max(-1,Math.min(1,samples[i]));
      v.setInt16(44+i*2, x<0?x*0x8000:x*0x7FFF, true);
    }
    return buf;
  }

  async function blobToWav(blob) {
    const raw  = await blob.arrayBuffer();
    const ctx  = new AudioContext();
    const ab   = await ctx.decodeAudioData(raw);
    ctx.close();
    const SR   = 16000;
    const off  = new OfflineAudioContext(1, Math.ceil(ab.duration * SR), SR);
    const src  = off.createBufferSource();
    src.buffer = ab; src.connect(off.destination); src.start();
    const res  = await off.startRendering();
    return new Blob([encodeWAV(res.getChannelData(0), SR)], { type: "audio/wav" });
  }

  // ── Flush accumulated data as one chunk ──────────────────────────────────────
  async function flushChunk() {
    if (pendingBufs.length === 0) return;
    const batch = pendingBufs.splice(0);          // grab & clear atomically
    const idx   = chunkIndex++;
    const raw   = new Blob(batch, { type: mimeType });
    console.log(`[IntraView] Flushing chunk ${idx} (${(raw.size/1024).toFixed(1)} KB)`);
    try {
      const wav = await blobToWav(raw);
      const res = await fetch(`${SERVER}/transcribe`, {
        method:  "POST",
        headers: { "Content-Type":"audio/wav", "X-Session-Id":sessionId, "X-Chunk-Index":String(idx) },
        body:    wav,
      });
      if (!res.ok) throw new Error(`Server ${res.status}`);
      const { transcript } = await res.json();
      if (transcript) {
        const preview = transcript.length > 55 ? transcript.slice(0,55)+"…" : transcript;
        showToast(`📝 Chunk ${idx+1}: "${preview}"`, "success");
      }
    } catch (err) {
      console.error("[IntraView] Chunk error:", err);
      showToast(`⚠️ Chunk ${idx+1} failed: ${err.message}`, "error");
    }
  }

  // ── Recording ────────────────────────────────────────────────────────────────
  async function startRecording() {
    try { micStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { showToast("❌ Mic access denied.", "error"); return; }

    mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus" : "audio/webm";

    pendingBufs  = [];
    chunkIndex   = 0;
    sessionId    = `iv-${Date.now()}`;
    isRecording  = true;

    mediaRecorder = new MediaRecorder(micStream, { mimeType });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) pendingBufs.push(e.data); };
    mediaRecorder.start(500);   // fire dataavailable every 500 ms

    // Flush every CHUNK_MS
    flushTimer = setInterval(flushChunk, CHUNK_MS);

    updateButton(); setDot(true);
    showToast("🎙️ Recording — flushing every 10 s.", "success");
  }

  function stopRecording() {
    isRecording = false;
    clearInterval(flushTimer);
    flushTimer = null;

    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.addEventListener("stop", () => {
        flushChunk();  // send any remaining < 10 s of audio
        micStream?.getTracks().forEach(t => t.stop());
        micStream = null;
      }, { once: true });
      mediaRecorder.stop();
    }

    updateButton(); setDot(false);
    showToast("⏹️ Stopped — sending final chunk…", "info");
  }

  function toggleRecording() {
    if (isRecording) stopRecording(); else startRecording();
  }

  // ── UI ───────────────────────────────────────────────────────────────────────
  function updateButton() {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    if (isRecording) {
      btn.classList.add("iv-recording"); btn.title = "Stop recording";
      btn.querySelector(".iv-btn-label").textContent = "Stop";
      btn.querySelector(".iv-btn-icon").textContent  = "⏹";
    } else {
      btn.classList.remove("iv-recording"); btn.title = "Start voice recording";
      btn.querySelector(".iv-btn-label").textContent = "Record";
      btn.querySelector(".iv-btn-icon").textContent  = "🎙";
    }
  }
  function setDot(on) { const d=document.getElementById(DOT_ID); if(d) d.style.display=on?"block":"none"; }

  function createButton() {
    if (document.getElementById(BTN_ID)) return;
    const btn = document.createElement("button");
    btn.id = BTN_ID; btn.title = "Start voice recording";
    btn.innerHTML = `<span class="iv-btn-icon">🎙</span><span class="iv-btn-label">Record</span><span id="${DOT_ID}" class="iv-pulse-dot" style="display:none;"></span>`;
    btn.addEventListener("click", toggleRecording);
    const sel = ["nav","[class*='NavBar']","[class*='header']","header","#__next nav"];
    for (const s of sel) {
      const t = document.querySelector(s);
      if (t) { const w=document.createElement("div"); w.className="iv-wrapper"; w.appendChild(btn); t.appendChild(w); return; }
    }
    btn.classList.add("iv-floating"); document.body.appendChild(btn);
  }

  function showToast(msg, type="info") {
    let t=document.getElementById(TOAST_ID);
    if (!t){t=document.createElement("div");t.id=TOAST_ID;document.body.appendChild(t);}
    t.className=`iv-toast iv-toast-${type} iv-toast-enter`; t.textContent=msg;
    clearTimeout(t._timer);
    t._timer=setTimeout(()=>{t.classList.add("iv-toast-exit");setTimeout(()=>{t.textContent="";t.className="iv-toast";},400);},4000);
  }

  function tryInject() {
    if (document.getElementById(BTN_ID)) return;
    if (document.querySelector("nav, header, [class*='NavBar']")) createButton();
  }
  new MutationObserver(tryInject).observe(document.body,{childList:true,subtree:true});
  tryInject();
  let lastHref=location.href;
  setInterval(()=>{ if(location.href!==lastHref){lastHref=location.href;setTimeout(tryInject,800);} },500);
})();
