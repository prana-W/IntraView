(function () {
  "use strict";

  const SERVER        = "http://localhost:8765";
  const CONTAINER_ID  = "intraview-record-container";
  const BTN_ID        = "intraview-record-btn";
  const TOAST_ID      = "intraview-toast";

  const CHUNK_MS      = 30_000;
  const LS_CODE_KEY    = "iv_accepted_code";
  const LS_PROBLEM_KEY = "iv_problem_desc";

  let isRecording   = false;
  let isPaused      = false;
  let micStream     = null;
  let mediaRecorder = null;
  let pendingBufs   = [];
  let flushedUpTo   = 0;
  let sentSamples   = 0;
  let chunkIndex    = 0;
  let sessionId     = null;
  let flushTimer    = null;
  let mimeType      = "";
  let flushPromise  = Promise.resolve();

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

  // Decode full accumulated blob → resample to 16 kHz mono → return all PCM samples
  async function decodeToSamples(blob) {
    const raw = await blob.arrayBuffer();
    const ctx = new AudioContext();
    const ab  = await ctx.decodeAudioData(raw);
    ctx.close();
    const SR  = 16000;
    const off = new OfflineAudioContext(1, Math.ceil(ab.duration * SR), SR);
    const src = off.createBufferSource();
    src.buffer = ab; src.connect(off.destination); src.start();
    const res = await off.startRendering();
    return { samples: res.getChannelData(0), sr: SR };
  }

  async function doFlush(isDone = false) {
    const snapshot = pendingBufs.slice();
    if (snapshot.length === flushedUpTo && !isDone) return; // Nothing to do

    flushedUpTo = snapshot.length;
    const idx = chunkIndex++;
    let delta = new Float32Array(0);
    let sr = 16000;

    if (snapshot.length > 0) {
      const fullBlob = new Blob(snapshot, { type: mimeType });
      try {
        const decoded = await decodeToSamples(fullBlob);
        delta = decoded.samples.slice(sentSamples);
        sr = decoded.sr;
        sentSamples = decoded.samples.length;
      } catch (err) {
        console.error("[IntraView] Decode error:", err);
      }
    }

    if (delta.length === 0 && !isDone) return;

    // On final flush: read accepted code from localStorage (if any)
    let codeSnapshotB64 = "";
    if (isDone) {
      const code = localStorage.getItem(LS_CODE_KEY) || "";
      if (code) {
        codeSnapshotB64 = btoa(unescape(encodeURIComponent(code)));
        console.log(`[IntraView] Sending accepted code snapshot (${code.length} chars)`);
        localStorage.removeItem(LS_CODE_KEY); // consumed — clear it
      }
    }

    try {

      const wav = new Blob([encodeWAV(delta, sr)], { type: "audio/wav" });
      const headers = {
        "Content-Type":      "audio/wav",
        "X-Session-Id":      sessionId,
        "X-Chunk-Index":     String(idx),
        "X-Problem-Url":     window.location.href,
        "X-Recording-Done":  isDone ? "true" : "false",
      };
      if (codeSnapshotB64) headers["X-Code-Snapshot"] = codeSnapshotB64;

      // On final flush: attach problem description if captured
      const problemDesc = isDone ? (localStorage.getItem(LS_PROBLEM_KEY) || "") : "";
      if (problemDesc) {
        headers["X-Problem-Description"] = btoa(unescape(encodeURIComponent(problemDesc)));
        localStorage.removeItem(LS_PROBLEM_KEY);
      }

      const res = await fetch(`${SERVER}/transcribe`, {
        method:  "POST",
        headers,
        body: wav,
      });

      if (!res.ok) throw new Error(`Server ${res.status}`);

      await res.json();
      if (isDone) showToast("✅ Transcript saved!", "success");
    } catch (err) {
      console.error("[IntraView] Chunk error:", err);
      showToast(`⚠️ Chunk ${idx+1} failed: ${err.message}`, "error");
    }
  }

  function flushChunk(isDone = false) {
    flushPromise = flushPromise.then(() => doFlush(isDone)).catch(err => console.error(err));
  }

  async function startRecording() {
    try { micStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { showToast("❌ Mic access denied.", "error"); return; }

    mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus" : "audio/webm";

    pendingBufs  = [];
    flushedUpTo  = 0;
    sentSamples  = 0;
    chunkIndex   = 0;
    sessionId    = `iv-${Date.now()}`;
    isRecording  = true;
    isPaused     = false;
    localStorage.removeItem(LS_CODE_KEY); // clear any stale accepted code from a prior session

    // Capture the problem description text at recording-start time
    const descEl = document.querySelector('[data-track-load="description_content"]');
    if (descEl) {
      // innerText gives clean readable text with newlines preserved
      const descText = descEl.innerText.trim().slice(0, 6000); // cap at 6 KB of text
      if (descText) {
        localStorage.setItem(LS_PROBLEM_KEY, descText);
        console.log(`[IntraView] Problem description captured (${descText.length} chars)`);
      }
    }

    mediaRecorder = new MediaRecorder(micStream, { mimeType });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) pendingBufs.push(e.data); };
    mediaRecorder.start(500);

    flushTimer = setInterval(() => flushChunk(false), CHUNK_MS);
    updateButton();
    showToast("Recording started!", "success");
  }

  function stopRecording() {
    if (!isRecording) return;
    isRecording = false;
    clearInterval(flushTimer);
    flushTimer = null;

    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.addEventListener("stop", async () => {
        flushChunk(true);   // final chunk → triggers MongoDB save on server
        
        try {
          const fullBlob = new Blob(pendingBufs, { type: mimeType });
          const decoded = await decodeToSamples(fullBlob);
          const wavBlob = new Blob([encodeWAV(decoded.samples, decoded.sr)], { type: "audio/wav" });

          await fetch(`${SERVER}/audio/${sessionId}`, {
            method: "POST",
            headers: { "Content-Type": "audio/wav" },
            body: wavBlob
          });
        } catch (err) {
          console.error("[IntraView] Failed to upload full audio:", err);
        }

        micStream?.getTracks().forEach(t => t.stop());
        micStream = null;
      }, { once: true });
      mediaRecorder.stop();
    }

    updateButton();
    showToast("Recording stopped...", "info");
  }

  function toggleRecording() {
    if (isRecording) stopRecording(); else startRecording();
  }

  function togglePause() {
    if (!isRecording || !mediaRecorder) return;
    if (mediaRecorder.state === "recording") {
      mediaRecorder.pause();
      isPaused = true;
      showToast("Recording paused", "info");
    } else if (mediaRecorder.state === "paused") {
      mediaRecorder.resume();
      isPaused = false;
      showToast("Recording resumed", "success");
    }
    updateButton();
  }

  function updateButton() {
    const mainBtn = document.getElementById(BTN_ID);
    const pauseBtn = document.getElementById("intraview-pause-btn");
    const stopBtn = document.getElementById("intraview-stop-btn");
    if (!mainBtn || !pauseBtn || !stopBtn) return;
    
    if (isRecording) {
      mainBtn.style.display = "none";
      pauseBtn.style.display = "inline-flex";
      stopBtn.style.display = "inline-flex";
      
      if (isPaused) {
        pauseBtn.querySelector(".iv-btn-label").textContent = "Resume";
        pauseBtn.classList.remove("iv-recording");
        pauseBtn.classList.add("iv-paused");
      } else {
        pauseBtn.querySelector(".iv-btn-label").textContent = "Pause";
        pauseBtn.classList.remove("iv-paused");
        pauseBtn.classList.add("iv-recording");
      }
    } else {
      mainBtn.style.display = "inline-flex";
      pauseBtn.style.display = "none";
      stopBtn.style.display = "none";
    }
  }

  function createButton() {
    if (document.getElementById(CONTAINER_ID)) return;
    
    const container = document.createElement("div");
    container.id = CONTAINER_ID;
    container.className = "iv-container";
    container.style.display = "flex";
    container.style.gap = "8px";

    const mainBtn = document.createElement("button");
    mainBtn.id = BTN_ID;
    mainBtn.className = "iv-action-btn";
    mainBtn.title = "Start voice recording";
    mainBtn.innerHTML = `<span class="iv-btn-label">IntraView</span>`;
    mainBtn.addEventListener("click", startRecording);

    const pauseBtn = document.createElement("button");
    pauseBtn.id = "intraview-pause-btn";
    pauseBtn.className = "iv-action-btn iv-recording";
    pauseBtn.style.display = "none";
    pauseBtn.title = "Pause/Resume recording";
    pauseBtn.innerHTML = `<span class="iv-btn-label">Pause</span>`;
    pauseBtn.addEventListener("click", togglePause);

    const stopBtn = document.createElement("button");
    stopBtn.id = "intraview-stop-btn";
    stopBtn.className = "iv-action-btn iv-recording";
    stopBtn.style.display = "none";
    stopBtn.title = "Stop recording";
    stopBtn.innerHTML = `<span class="iv-btn-label">Stop</span>`;
    stopBtn.addEventListener("click", stopRecording);

    container.appendChild(mainBtn);
    container.appendChild(pauseBtn);
    container.appendChild(stopBtn);

    const sel = ["nav","[class*='NavBar']","[class*='header']","header","#__next nav"];
    for (const s of sel) {
      const t = document.querySelector(s);
      if (t) { const w=document.createElement("div"); w.className="iv-wrapper"; w.appendChild(container); t.appendChild(w); return; }
    }
    container.classList.add("iv-floating"); document.body.appendChild(container);
  }

  function showToast(msg, type="info", persist=false) {
    let t=document.getElementById(TOAST_ID);
    if (!t){t=document.createElement("div");t.id=TOAST_ID;document.body.appendChild(t);}
    t.style.display = "block";
    t.className=`iv-toast iv-toast-${type} iv-toast-enter`; t.textContent=msg;
    clearTimeout(t._timer);
    if (!persist) {
      t._timer=setTimeout(()=>{
        t.className="iv-toast iv-toast-exit";
        setTimeout(()=>{t.style.display="none";t.textContent="";},400);
      },4000);
    }
  }

  function tryInject() {
    if (document.getElementById(CONTAINER_ID)) return;
    if (document.querySelector("nav, header, [class*='NavBar']")) createButton();
  }

  // Watch for LeetCode's "Accepted" result and capture the submitted code.
  // The submitted code appears in a <pre><code> block inside the result panel.
  function watchForAcceptedResult() {
    let lastSeenCode = null; // avoid re-capturing the same submission

    const observer = new MutationObserver(() => {
      const resultEl = document.querySelector('[data-e2e-locator="submission-result"]');
      if (!resultEl) return;
      if (resultEl.textContent.trim() !== "Accepted") return;

      // Find the submitted code block — LeetCode renders it in a <pre><code> element
      const codeEl = document.querySelector("pre code");
      if (!codeEl) return;

      const code = codeEl.textContent.trim();
      if (!code || code === lastSeenCode) return; // nothing new

      lastSeenCode = code;
      localStorage.setItem(LS_CODE_KEY, code);
      console.log(`[IntraView] ✅ Accepted — code captured (${code.length} chars)`);
      // showToast("Code captured from accepted submission!", "success");
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  async function init() {
    tryInject();
    new MutationObserver(tryInject).observe(document.body, { childList: true, subtree: true });
    watchForAcceptedResult();
  }

  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      setTimeout(() => {
        setTimeout(tryInject, 800);
      }, 300);
    }
  }, 500);

  init();
})();
