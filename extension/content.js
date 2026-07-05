(function () {
  "use strict";

  const SERVER   = "http://localhost:8765";
  const BTN_ID   = "intraview-record-btn";
  const TOAST_ID = "intraview-toast";
  const DOT_ID   = "intraview-indicator";
  const OVERLAY_ID = "iv-auth-overlay";
  const CHUNK_MS = 10_000;
  const TOKEN_TTL = 10 * 24 * 60 * 60 * 1000; // 10 days

  let isRecording   = false;
  let micStream     = null;
  let mediaRecorder = null;
  let pendingBufs   = [];
  let flushedUpTo   = 0;
  let sentSamples   = 0;
  let chunkIndex    = 0;
  let sessionId     = null;
  let flushTimer    = null;
  let mimeType      = "";
  let currentToken  = null;   // in-memory mirror of storage token


  function saveToken(token) {
    currentToken = token;
    chrome.storage.local.set({ iv_token: token, iv_token_exp: Date.now() + TOKEN_TTL });
  }

  function clearToken() {
    currentToken = null;
    chrome.storage.local.remove(["iv_token", "iv_token_exp", "iv_user"]);
  }

  async function loadToken() {
    return new Promise(resolve => {
      chrome.storage.local.get(["iv_token", "iv_token_exp"], data => {
        if (data.iv_token && data.iv_token_exp > Date.now()) {
          currentToken = data.iv_token;
          resolve(data.iv_token);
        } else {
          currentToken = null;
          resolve(null);
        }
      });
    });
  }


  function removeOverlay() {
    const el = document.getElementById(OVERLAY_ID);
    if (!el) return;
    el.classList.add("iv-hidden");
    setTimeout(() => el.remove(), 300);
  }

  function showAuthOverlay(loggedInUser = null) {
    if (document.getElementById(OVERLAY_ID)) return;

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;

    if (loggedInUser) {
      // Show logged-in state with a logout option
      overlay.innerHTML = `
        <div class="iv-auth-card">
          <div class="iv-auth-logo">
            <span class="iv-logo-icon">🎙️</span>
            <h2>IntraView</h2>
            <p>Voice recorder for LeetCode</p>
          </div>
          <div class="iv-auth-loggedin">
            <p>Logged in as <strong>${loggedInUser.username || loggedInUser.email}</strong></p>
            <button class="iv-auth-logout" id="iv-logout-btn">Logout</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      document.getElementById("iv-logout-btn").addEventListener("click", () => {
        clearToken();
        removeOverlay();
        // Re-check auth (will show login form)
        setTimeout(() => checkAuth(), 350);
      });
    } else {
      // Show login / register form
      overlay.innerHTML = `
        <div class="iv-auth-card">
          <button id="iv-close-overlay" style="position:absolute; top:16px; right:16px; background:none; border:none; color:rgba(255,255,255,0.5); font-size:18px; cursor:pointer; padding:4px;">✖</button>
          <div class="iv-auth-logo">
            <span class="iv-logo-icon">🎙️</span>
            <h2>IntraView</h2>
            <p>Sign in to start recording</p>
          </div>
          <div class="iv-auth-tabs">
            <button class="iv-auth-tab iv-active" id="iv-tab-login">Login</button>
            <button class="iv-auth-tab"           id="iv-tab-register">Register</button>
          </div>

          <!-- Login form -->
          <form id="iv-login-form">
            <div class="iv-auth-field">
              <label>Email</label>
              <input type="email" id="iv-login-email" placeholder="you@example.com" autocomplete="email" required />
            </div>
            <div class="iv-auth-field">
              <label>Password</label>
              <input type="password" id="iv-login-pass" placeholder="••••••••" autocomplete="current-password" required />
            </div>
            <button type="submit" class="iv-auth-submit" id="iv-login-submit">Login</button>
            <div class="iv-auth-error" id="iv-login-err" style="display:none"></div>
          </form>

          <!-- Register form (hidden) -->
          <form id="iv-register-form" style="display:none">
            <div class="iv-auth-field">
              <label>Username</label>
              <input type="text" id="iv-reg-user" placeholder="coolcoder" autocomplete="username" required />
            </div>
            <div class="iv-auth-field">
              <label>Email</label>
              <input type="email" id="iv-reg-email" placeholder="you@example.com" autocomplete="email" required />
            </div>
            <div class="iv-auth-field">
              <label>Password</label>
              <input type="password" id="iv-reg-pass" placeholder="min 6 characters" autocomplete="new-password" required />
            </div>
            <button type="submit" class="iv-auth-submit" id="iv-reg-submit">Create Account</button>
            <div class="iv-auth-error" id="iv-reg-err" style="display:none"></div>
          </form>
        </div>`;

      document.body.appendChild(overlay);

      document.getElementById("iv-close-overlay").addEventListener("click", removeOverlay);


      // Tab switching
      const loginForm  = document.getElementById("iv-login-form");
      const regForm    = document.getElementById("iv-register-form");
      const tabLogin   = document.getElementById("iv-tab-login");
      const tabReg     = document.getElementById("iv-tab-register");

      tabLogin.addEventListener("click", () => {
        tabLogin.classList.add("iv-active"); tabReg.classList.remove("iv-active");
        loginForm.style.display = ""; regForm.style.display = "none";
      });
      tabReg.addEventListener("click", () => {
        tabReg.classList.add("iv-active"); tabLogin.classList.remove("iv-active");
        regForm.style.display = ""; loginForm.style.display = "none";
      });

      // Login submit
      loginForm.addEventListener("submit", async e => {
        e.preventDefault();
        const btn = document.getElementById("iv-login-submit");
        const err = document.getElementById("iv-login-err");
        btn.disabled = true; btn.textContent = "Signing in…";
        err.style.display = "none";
        try {
          const res = await fetch(`${SERVER}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email:    document.getElementById("iv-login-email").value,
              password: document.getElementById("iv-login-pass").value,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Login failed");
          saveToken(data.token);
          chrome.storage.local.set({ iv_user: data.user });
          removeOverlay();
          tryInject();
          showToast(`✅ Welcome back, ${data.user.username}!`, "success");
        } catch (ex) {
          err.textContent = ex.message; err.style.display = "block";
        } finally {
          btn.disabled = false; btn.textContent = "Login";
        }
      });

      // Register submit
      regForm.addEventListener("submit", async e => {
        e.preventDefault();
        const btn = document.getElementById("iv-reg-submit");
        const err = document.getElementById("iv-reg-err");
        btn.disabled = true; btn.textContent = "Creating…";
        err.style.display = "none";
        try {
          const res = await fetch(`${SERVER}/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username: document.getElementById("iv-reg-user").value,
              email:    document.getElementById("iv-reg-email").value,
              password: document.getElementById("iv-reg-pass").value,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Registration failed");
          saveToken(data.token);
          chrome.storage.local.set({ iv_user: data.user });
          removeOverlay();
          tryInject();
          showToast(`🎉 Account created! Welcome, ${data.user.username}!`, "success");
        } catch (ex) {
          err.textContent = ex.message; err.style.display = "block";
        } finally {
          btn.disabled = false; btn.textContent = "Create Account";
        }
      });
    }

    // Close on backdrop click (not on the card itself)
    overlay.addEventListener("click", e => {
      if (e.target === overlay && loggedInUser) removeOverlay();
    });
  }


  async function checkAuth() {
    const token = await loadToken();

    if (!token) {
      showAuthOverlay(null);
      return false;
    }

    try {
      const res = await fetch(`${SERVER}/auth/whoami`, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (res.ok) {
        const { user } = await res.json();
        // Token is valid — no overlay needed, silently proceed
        chrome.storage.local.set({ iv_user: user });
        return true;
      } else {
        // Token expired or invalid
        clearToken();
        showAuthOverlay(null);
        return false;
      }
    } catch {
      // Server unreachable
      showToast("⚠️ Server unreachable.", "error");
      return false;
    }
  }

  let healthPolling = false;
  async function pollHealth() {
    if (healthPolling) return;
    try {
      const res = await fetch(`${SERVER}/health`);
      if (res.ok) return; // connected, nothing to do
    } catch (err) {
      // failed, start polling
    }
    
    healthPolling = true;
    showToast("🔄 Server is connecting...", "info", true);

    const check = async () => {
      if (!healthPolling) return;
      try {
        const res = await fetch(`${SERVER}/health`);
        if (res.ok) {
          showToast("✅ Server connected!", "success");
          healthPolling = false;
          return;
        }
      } catch (err) {}
      setTimeout(check, 3000);
    };
    setTimeout(check, 3000);
  }


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


  async function flushChunk(isDone = false) {
    if (pendingBufs.length === flushedUpTo) return;

    const snapshot = pendingBufs.slice();
    flushedUpTo    = pendingBufs.length;
    const idx      = chunkIndex++;
    const fullBlob = new Blob(snapshot, { type: mimeType });

    try {
      const { samples, sr } = await decodeToSamples(fullBlob);
      const delta = samples.slice(sentSamples);
      sentSamples  = samples.length;
      if (delta.length === 0) return;

      const wav = new Blob([encodeWAV(delta, sr)], { type: "audio/wav" });
      const token = currentToken || await loadToken();
      const res = await fetch(`${SERVER}/transcribe`, {
        method:  "POST",
        headers: {
          "Content-Type":    "audio/wav",
          "Authorization":   `Bearer ${token}`,
          "X-Session-Id":    sessionId,
          "X-Chunk-Index":   String(idx),
          "X-Problem-Url":   window.location.href,
          "X-Recording-Done": isDone ? "true" : "false",
        },
        body: wav,
      });

      if (res.status === 401) {
        clearToken();
        showToast("⚠️ Session expired — please login again.", "error");
        stopRecording();
        showAuthOverlay(null);
        return;
      }
      if (!res.ok) throw new Error(`Server ${res.status}`);

      await res.json();
      if (isDone) showToast("✅ Transcript saved!", "success");
    } catch (err) {
      console.error("[IntraView] Chunk error:", err);
      showToast(`⚠️ Chunk ${idx+1} failed: ${err.message}`, "error");
    }
  }


  async function startRecording() {
    const isAuth = await checkAuth();
    if (!isAuth) return;

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

    mediaRecorder = new MediaRecorder(micStream, { mimeType });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) pendingBufs.push(e.data); };
    mediaRecorder.start(500);

    flushTimer = setInterval(() => flushChunk(false), CHUNK_MS);
    updateButton(); setDot(true);
    showToast("🎙️ Recording — flushing every 10 s.", "success");
  }

  function stopRecording() {
    if (!isRecording) return;
    isRecording = false;
    clearInterval(flushTimer);
    flushTimer = null;

    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.addEventListener("stop", () => {
        flushChunk(true);   // final chunk → triggers MongoDB save on server
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


  function updateButton() {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    if (isRecording) {
      btn.classList.add("iv-recording"); btn.title = "Stop recording";
      btn.querySelector(".iv-btn-label").textContent = "Stop";
    } else {
      btn.classList.remove("iv-recording"); btn.title = "Start voice recording";
      btn.querySelector(".iv-btn-label").textContent = "IntraView";
    }
  }

  function setDot(on) { const d=document.getElementById(DOT_ID); if(d) d.style.display=on?"block":"none"; }

  function createButton() {
    if (document.getElementById(BTN_ID)) return;
    const btn = document.createElement("button");
    btn.id = BTN_ID; btn.title = "Start voice recording";
    btn.innerHTML = `<span class="iv-btn-label">IntraView</span><span id="${DOT_ID}" class="iv-pulse-dot" style="display:none;"></span>`;
    btn.addEventListener("click", toggleRecording);
    const sel = ["nav","[class*='NavBar']","[class*='header']","header","#__next nav"];
    for (const s of sel) {
      const t = document.querySelector(s);
      if (t) { const w=document.createElement("div"); w.className="iv-wrapper"; w.appendChild(btn); t.appendChild(w); return; }
    }
    btn.classList.add("iv-floating"); document.body.appendChild(btn);
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
    if (document.getElementById(BTN_ID)) return;
    if (document.querySelector("nav, header, [class*='NavBar']")) createButton();
  }


  async function init() {
    pollHealth();
    tryInject();
    new MutationObserver(tryInject).observe(document.body, { childList: true, subtree: true });
  }

  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      setTimeout(() => {
        pollHealth();
        setTimeout(tryInject, 800);
      }, 300);
    }
  }, 500);

  init();
})();
