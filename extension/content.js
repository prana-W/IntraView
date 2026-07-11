(function () {
  "use strict";

  const SERVER       = "http://localhost:8765";
  const WS_URL       = "ws://localhost:8765";
  const CONTAINER_ID = "intraview-record-container";
  const BTN_ID       = "intraview-record-btn";
  const TOAST_ID     = "intraview-toast";
  const OVERLAY_ID   = "iv-interview-overlay";

  // Interview mode chunk size (15s, matches cfg.CHUNK_MS on server)
  const CHUNK_MS      = 15_000;
  const LS_CODE_KEY   = "iv_accepted_code";
  const LS_PROBLEM_KEY = "iv_problem_desc";

  // ── State ──────────────────────────────────────────────────────────────────
  let isRecording    = false;
  let isPaused       = false;
  let micStream      = null;
  let mediaRecorder  = null;
  let pendingBufs    = [];
  let flushedUpTo    = 0;
  let sentSamples    = 0;
  let chunkIndex     = 0;
  let sessionId      = null;
  let flushTimer     = null;
  let mimeType       = "";
  let flushPromise   = Promise.resolve();

  // WebSocket (opened directly from content script — no background relay needed)
  let ws             = null;

  // Interview overlay state
  let currentStage   = "INTRO";

  let speakingTimer  = null;
  let speakingSeconds = 0;

  // Stage colours (must match interview.config.js STAGE_META)
  const STAGE_META = {
    INTRO:      { label: "Introduction", color: "#38bdf8" },
    APPROACH:   { label: "Approach",     color: "#a78bfa" },
    COMPLEXITY: { label: "Complexity",   color: "#34d399" },
    CODING:     { label: "Coding",       color: "#fb923c" },
    REVIEW:     { label: "Code Review",  color: "#f472b6" },
    CLOSE:      { label: "Wrap-up",      color: "#facc15" },
  };
  const STAGES = ["INTRO", "APPROACH", "COMPLEXITY", "CODING", "REVIEW", "CLOSE"];

  // ── WebSocket helpers (direct — no background relay) ────────────────────

  function wsConnect(onReady) {
    if (ws && ws.readyState === WebSocket.OPEN) { onReady?.(); return; }
    ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      console.log("[IntraView] WS connected ✅");
      onReady?.();
    };
    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      switch (msg.type) {
        case "thinking":       setOverlayThinking(); break;
        case "ai_question":    setOverlayQuestion(msg.text, msg.stage); speakingSeconds = 0; break;
        case "ai_hint":        showHintBubble(msg.text); break;
        case "interview_done": showToast("✅ Interview complete! Check your dashboard.", "success", true); break;
        case "error":          showToast(`⚠️ ${msg.message || "Server error"}`, "error"); break;
      }
    };
    ws.onerror = () => {
      showToast("❌ Cannot reach server — is it running on port 8765?", "error", true);
    };
    ws.onclose = () => { console.log("[IntraView] WS closed"); ws = null; };
  }

  function wsSend(payload) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    } else {
      console.warn("[IntraView] WS not open, cannot send:", payload.type);
    }
  }

  // ── Audio helpers ──────────────────────────────────────────────────────────

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

  // ── Flush / transcription ─────────────────────────────────────────────────

  async function doFlush(isDone = false) {
    const snapshot = pendingBufs.slice();
    if (snapshot.length === flushedUpTo && !isDone) return;

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

    let codeSnapshotB64 = "";
    if (isDone) {
      const code = localStorage.getItem(LS_CODE_KEY) || "";
      if (code) {
        codeSnapshotB64 = btoa(unescape(encodeURIComponent(code)));
        localStorage.removeItem(LS_CODE_KEY);
      }
    }

    try {
      const wav = new Blob([encodeWAV(delta, sr)], { type: "audio/wav" });
      const headers = {
        "Content-Type":     "audio/wav",
        "X-Session-Id":     sessionId,
        "X-Chunk-Index":    String(idx),
        "X-Problem-Url":    window.location.href,
        "X-Recording-Done": isDone ? "true" : "false",
      };
      if (codeSnapshotB64) headers["X-Code-Snapshot"] = codeSnapshotB64;

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

      if (isDone) showToast("✅ Interview saved!", "success");
    } catch (err) {
      console.error("[IntraView] Chunk error:", err);
      showToast(`⚠️ Chunk ${idx+1} failed: ${err.message}`, "error");
    }
  }

  function flushChunk(isDone = false) {
    flushPromise = flushPromise.then(() => doFlush(isDone)).catch(err => console.error(err));
  }

  // ── Recording lifecycle ───────────────────────────────────────────────────

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
    currentStage = "INTRO";
    localStorage.removeItem(LS_CODE_KEY);

    // Capture problem description
    const descEl = document.querySelector('[data-track-load="description_content"]');
    if (descEl) {
      const descText = descEl.innerText.trim().slice(0, 6000);
      if (descText) localStorage.setItem(LS_PROBLEM_KEY, descText);
    }

    // Start media recorder
    mediaRecorder = new MediaRecorder(micStream, { mimeType });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) pendingBufs.push(e.data); };
    mediaRecorder.start(500);

    // Flush every CHUNK_MS (15s in interview mode)
    flushTimer = setInterval(() => flushChunk(false), CHUNK_MS);

    // Scrape page content for AI and open WebSocket
    const pageContent = scrapePageContent();
    wsConnect(() => {
      wsSend({ type: "start_interview", sessionId, pageContent });
    });

    updateButton();
    showOverlay();
    startSpeakingTimer();
    showToast("🎙 Interview started!", "success");
  }

  function stopRecording() {
    if (!isRecording) return;
    isRecording = false;
    clearInterval(flushTimer);
    clearInterval(speakingTimer);
    flushTimer = null;

    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.addEventListener("stop", async () => {
        flushChunk(true);

        // Upload full audio blob for playback
        try {
          const fullBlob = new Blob(pendingBufs, { type: mimeType });
          const decoded  = await decodeToSamples(fullBlob);
          const wavBlob  = new Blob([encodeWAV(decoded.samples, decoded.sr)], { type: "audio/wav" });
          await fetch(`${SERVER}/audio/${sessionId}`, {
            method:  "POST",
            headers: { "Content-Type": "audio/wav" },
            body:    wavBlob,
          });
        } catch (err) {
          console.error("[IntraView] Failed to upload full audio:", err);
        }

        micStream?.getTracks().forEach(t => t.stop());
        micStream = null;
      }, { once: true });
      mediaRecorder.stop();
    }

    // Tell server to end interview session and persist to DB
    wsSend({ type: "end_interview", sessionId });
    if (ws) { ws.close(); ws = null; }

    updateButton();
    removeOverlay();
    showToast("Interview ended. Saving…", "info");
  }

  function togglePause() {
    if (!isRecording || !mediaRecorder) return;
    if (mediaRecorder.state === "recording") {
      mediaRecorder.pause();
      isPaused = true;
      clearInterval(speakingTimer);
      showToast("Recording paused", "info");
    } else if (mediaRecorder.state === "paused") {
      mediaRecorder.resume();
      isPaused = false;
      startSpeakingTimer();
      showToast("Recording resumed", "success");
    }
    updateButton();
    updateOverlayPauseState();
  }

  function onNextClicked() {
    if (!isRecording) return;
    // Tell server directly via WebSocket
    wsSend({ type: "next_turn", sessionId });
    speakingSeconds = 0;
    setOverlayThinking();
    showToast("Waiting for interviewer…", "info");
  }

  // ── Page content scraper ──────────────────────────────────────────────────

  function scrapePageContent() {
    const parts = [];
    // Problem title
    const titleEl = document.querySelector("[data-cy='question-title'], h4[class*='title'], h1");
    if (titleEl) parts.push("Problem: " + titleEl.innerText.trim());
    // Problem description
    const descEl = document.querySelector('[data-track-load="description_content"]');
    if (descEl) parts.push("Description:\n" + descEl.innerText.trim().slice(0, 5000));
    // Fallback: just use page title + first 2000 chars of body text
    if (parts.length === 0) {
      parts.push("Page: " + document.title);
      parts.push(document.body.innerText.slice(0, 2000));
    }
    return parts.join("\n\n");
  }

  // ── Overlay UI ────────────────────────────────────────────────────────────

  function showOverlay() {
    if (document.getElementById(OVERLAY_ID)) return;

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.className = "iv-overlay";
    overlay.innerHTML = `
      <div class="iv-overlay-header">
        <span class="iv-overlay-brand">🎙 IntraView</span>
        <span class="iv-stage-badge" id="iv-stage-badge">INTRO</span>
      </div>
      <div class="iv-stage-dots" id="iv-stage-dots">
        ${STAGES.map((s, i) => `<div class="iv-dot ${i === 0 ? 'iv-dot-active' : ''}" data-stage="${s}" title="${STAGE_META[s]?.label || s}"></div>`).join("")}
      </div>
      <div class="iv-overlay-body" id="iv-overlay-body">
        <div class="iv-thinking" id="iv-thinking">
          <span></span><span></span><span></span>
          <small>Connecting to interviewer…</small>
        </div>
        <p class="iv-question-text" id="iv-question-text" style="display:none"></p>
      </div>
      <div class="iv-overlay-footer">
        <span class="iv-speaking-timer" id="iv-speaking-timer">🎙 0:00</span>
        <div class="iv-overlay-actions">
          <button class="iv-ov-btn iv-ov-pause" id="iv-ov-pause">Pause</button>
          <button class="iv-ov-btn iv-ov-next"  id="iv-ov-next">➜ Next</button>
          <button class="iv-ov-btn iv-ov-end"   id="iv-ov-end">■ End</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    document.getElementById("iv-ov-pause").addEventListener("click", togglePause);
    document.getElementById("iv-ov-next").addEventListener("click",  onNextClicked);
    document.getElementById("iv-ov-end").addEventListener("click",   stopRecording);
  }

  function removeOverlay() {
    const el = document.getElementById(OVERLAY_ID);
    if (el) { el.classList.add("iv-overlay-exit"); setTimeout(() => el.remove(), 400); }
  }

  function setOverlayThinking() {
    const thinking = document.getElementById("iv-thinking");
    const questionEl = document.getElementById("iv-question-text");
    if (thinking)    { thinking.style.display = "flex"; }
    if (questionEl)  { questionEl.style.display = "none"; }
  }

  function setOverlayQuestion(text, stage) {
    const thinking   = document.getElementById("iv-thinking");
    const questionEl = document.getElementById("iv-question-text");
    const badgeEl    = document.getElementById("iv-stage-badge");
    if (thinking)    { thinking.style.display = "none"; }
    if (questionEl)  { questionEl.textContent = text; questionEl.style.display = "block"; }
    if (badgeEl && stage) {
      currentStage = stage;
      const meta = STAGE_META[stage] || {};
      badgeEl.textContent = meta.label || stage;
      badgeEl.style.background = meta.color || "#6366f1";
      updateStageDots(stage);
    }
  }

  function showHintBubble(text) {
    // Remove existing hint if any
    const existing = document.getElementById("iv-hint-card");
    if (existing) existing.remove();

    const card = document.createElement("div");
    card.id = "iv-hint-card";
    card.className = "iv-hint-card";
    card.innerHTML = `<span class="iv-hint-icon">💡</span><p>${text}</p><button class="iv-hint-close">✕</button>`;
    document.body.appendChild(card);
    card.querySelector(".iv-hint-close").addEventListener("click", () => {
      card.classList.add("iv-hint-exit");
      setTimeout(() => card.remove(), 400);
    });
    // Auto-dismiss after 30s
    setTimeout(() => { card.classList.add("iv-hint-exit"); setTimeout(() => card.remove(), 400); }, 30000);
  }

  function updateStageDots(activeStage) {
    const dots = document.querySelectorAll("#iv-stage-dots .iv-dot");
    const activeIdx = STAGES.indexOf(activeStage);
    dots.forEach((dot, i) => {
      dot.classList.toggle("iv-dot-active",    i === activeIdx);
      dot.classList.toggle("iv-dot-completed", i < activeIdx);
    });
  }

  function updateOverlayPauseState() {
    const pauseBtn = document.getElementById("iv-ov-pause");
    if (!pauseBtn) return;
    pauseBtn.textContent = isPaused ? "Resume" : "Pause";
    pauseBtn.classList.toggle("iv-ov-paused", isPaused);
  }

  function startSpeakingTimer() {
    clearInterval(speakingTimer);
    speakingSeconds = 0;
    speakingTimer = setInterval(() => {
      speakingSeconds++;
      const el = document.getElementById("iv-speaking-timer");
      if (el) {
        const m = Math.floor(speakingSeconds / 60);
        const s = String(speakingSeconds % 60).padStart(2, "0");
        el.textContent = `🎙 ${m}:${s}`;
      }
    }, 1000);
  }

  // ── Button rendering ──────────────────────────────────────────────────────

  function updateButton() {
    const mainBtn  = document.getElementById(BTN_ID);
    const pauseBtn = document.getElementById("intraview-pause-btn");
    const stopBtn  = document.getElementById("intraview-stop-btn");
    if (!mainBtn || !pauseBtn || !stopBtn) return;

    if (isRecording) {
      mainBtn.style.display  = "none";
      pauseBtn.style.display = "inline-flex";
      stopBtn.style.display  = "inline-flex";

      if (isPaused) {
        pauseBtn.querySelector(".iv-btn-label").textContent = "Resume";
        pauseBtn.classList.remove("iv-recording"); pauseBtn.classList.add("iv-paused");
      } else {
        pauseBtn.querySelector(".iv-btn-label").textContent = "Pause";
        pauseBtn.classList.remove("iv-paused"); pauseBtn.classList.add("iv-recording");
      }
    } else {
      mainBtn.style.display  = "inline-flex";
      pauseBtn.style.display = "none";
      stopBtn.style.display  = "none";
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
    mainBtn.title = "Start AI interview";
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
    stopBtn.title = "End interview";
    stopBtn.innerHTML = `<span class="iv-btn-label">End Interview</span>`;
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

  // ── Toast ─────────────────────────────────────────────────────────────────

  function showToast(msg, type="info", persist=false) {
    let t=document.getElementById(TOAST_ID);
    if (!t){t=document.createElement("div");t.id=TOAST_ID;document.body.appendChild(t);}
    t.style.display="block";
    t.className=`iv-toast iv-toast-${type} iv-toast-enter`; t.textContent=msg;
    clearTimeout(t._timer);
    if (!persist) {
      t._timer=setTimeout(()=>{
        t.className="iv-toast iv-toast-exit";
        setTimeout(()=>{t.style.display="none";t.textContent="";},400);
      },4000);
    }
  }




  // ── Accepted submission watcher ───────────────────────────────────────────

  function watchForAcceptedResult() {
    let lastSeenCode = null;
    const observer = new MutationObserver(() => {
      const resultEl = document.querySelector('[data-e2e-locator="submission-result"]');
      if (!resultEl) return;
      if (resultEl.textContent.trim() !== "Accepted") return;
      const codeEl = document.querySelector("pre code");
      if (!codeEl) return;
      const code = codeEl.textContent.trim();
      if (!code || code === lastSeenCode) return;
      lastSeenCode = code;
      localStorage.setItem(LS_CODE_KEY, code);
      console.log(`[IntraView] ✅ Accepted — code captured (${code.length} chars)`);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  function tryInject() {
    if (document.getElementById(CONTAINER_ID)) return;
    if (document.querySelector("nav, header, [class*='NavBar']")) createButton();
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
      setTimeout(() => setTimeout(tryInject, 800), 300);
    }
  }, 500);

  init();
})();
