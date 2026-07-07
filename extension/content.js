(function () {
  "use strict";

  let state = {
    videoId: null,
    transcript: null,
    summary: null,
    messages: [],
    withTimestamps: false,
  };

  function getVideoId() {
    const u = new URL(window.location.href);
    if (u.pathname === "/watch") return u.searchParams.get("v");
    if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2];
    return null;
  }

  function start() {
    if (document.getElementById("yt-ts-panel")) {
      cleanup();
    }
    const id = getVideoId();
    if (id) {
      state = { videoId: id, transcript: null, summary: null, messages: [], withTimestamps: false };
      injectPanel();
      injectOwnerBtn();
    }
  }

  document.addEventListener("yt-navigate-finish", start);
  start();

  function cleanup() {
    const p = document.getElementById("yt-ts-panel");
    const b = document.getElementById("yt-ts-owner-btn");
    if (p) p.remove();
    if (b) b.remove();
  }

  function qs(s) { return document.querySelector(s); }

  function waitFor(sel) {
    return new Promise((r) => {
      if (qs(sel)) return r(qs(sel));
      const o = new MutationObserver(() => {
        if (qs(sel)) { o.disconnect(); r(qs(sel)); }
      });
      o.observe(document.body, { childList: true, subtree: true });
    });
  }

  // --- inject panel below description ---
  async function injectPanel() {
    if (document.getElementById("yt-ts-panel")) return;
    let target = qs("#description") || (await waitFor("#description"));
    if (!target) return;

    const p = document.createElement("div");
    p.id = "yt-ts-panel";
    p.className = "yt-ts-panel yt-ts-hide";
    p.innerHTML = `
      <div class="yt-ts-body">
        <div class="yt-ts-body-header">
          <span class="yt-ts-body-title">Transcript</span>
          <label class="yt-ts-tslabel">
            <input type="checkbox" id="yt-ts-tscb" /> Timestamps
          </label>
        </div>
        <div id="yt-ts-content" class="yt-ts-content"></div>
        <div id="yt-ts-toolbar" class="yt-ts-toolbar yt-ts-hide">
          <button id="yt-ts-copy" class="yt-ts-btn yt-ts-btn-sm">📋 Copy</button>
          <button id="yt-ts-sum" class="yt-ts-btn yt-ts-btn-sm">✨ Summarize</button>
        </div>
        <div id="yt-ts-summary" class="yt-ts-summary yt-ts-hide"></div>
        <div id="yt-ts-chat" class="yt-ts-chat yt-ts-hide">
          <div id="yt-ts-chatmsgs" class="yt-ts-chatmsgs"></div>
          <div class="yt-ts-chatrow">
            <input type="text" id="yt-ts-chatin" class="yt-ts-chatin" placeholder="Ask about this video..." />
            <button id="yt-ts-chatsend" class="yt-ts-btn yt-ts-btn-sm">Send</button>
          </div>
        </div>
      </div>
    `;
    target.parentNode.insertBefore(p, target.nextSibling);

    byId("yt-ts-tscb").onchange = (e) => {
      state.withTimestamps = e.target.checked;
      if (state.transcript) renderTranscript();
    };
    byId("yt-ts-copy").onclick = copyTranscript;
    byId("yt-ts-sum").onclick = summarize;
    byId("yt-ts-chatsend").onclick = sendChat;
    byId("yt-ts-chatin").onkeydown = (e) => { if (e.key === "Enter") sendChat(); };
  }

  // --- inject button next to subscribe ---
  async function injectOwnerBtn() {
    if (document.getElementById("yt-ts-owner-btn")) return;
    console.log("YT Transcript: looking for #owner");
    const owner = qs("#owner") || (await waitFor("#owner"));
    if (!owner) { console.log("YT Transcript: #owner not found"); return; }
    console.log("YT Transcript: #owner found");

    const subBtn = owner.querySelector("ytd-subscribe-button-renderer");
    if (!subBtn) { console.log("YT Transcript: subscribe button not found"); return; }
    console.log("YT Transcript: subscribe button found, injecting button");

    const btn = document.createElement("button");
    btn.id = "yt-ts-owner-btn";
    btn.className = "yt-ts-owner-btn";
    btn.textContent = "Transcript";
    btn.onclick = toggleTranscript;
    subBtn.parentNode.insertBefore(btn, subBtn.nextSibling);
    console.log("YT Transcript: button injected");
  }

  function byId(id) { return document.getElementById(id); }

  function toggleTranscript() {
    const panel = byId("yt-ts-panel");
    const btn = byId("yt-ts-owner-btn");
    if (!panel) return;
    if (panel.classList.contains("yt-ts-hide")) {
      panel.classList.remove("yt-ts-hide");
      btn.textContent = "Hide";
      if (!state.transcript) fetchTranscript();
    } else {
      panel.classList.add("yt-ts-hide");
      btn.textContent = "Transcript";
    }
  }

  async function fetchTranscript() {
    const el = byId("yt-ts-content");
    el.innerHTML = '<div class="yt-ts-loading">Loading transcript...</div>';

    try {
      const r = await chrome.runtime.sendMessage({ action: "fetchTranscript", videoId: state.videoId });
      if (!r.success) throw new Error(r.error);
      state.transcript = r.data;
      renderTranscript();
      byId("yt-ts-toolbar").classList.remove("yt-ts-hide");
    } catch (e) {
      el.innerHTML = `<div class="yt-ts-err">${esc(e.message)}</div>`;
    }
  }

  function renderTranscript() {
    const el = byId("yt-ts-content");
    const lines = state.transcript.map((s) => {
      const t = s.text;
      return state.withTimestamps ? `${fmtTs(s.start)} ${t}` : t;
    });
    const cleaned = lines.filter((l, i, a) => i === 0 || l !== a[i - 1]);
    el.innerHTML = `<div class="yt-ts-text">${esc(cleaned.join("\n"))}</div>`;
  }

  function fmtTs(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function copyTranscript() {
    const t = qs(".yt-ts-text");
    if (!t) return;
    navigator.clipboard.writeText(t.textContent).then(() => {
      const btn = byId("yt-ts-copy");
      btn.textContent = "✅ Copied!";
      setTimeout(() => (btn.textContent = "📋 Copy"), 2000);
    });
  }

  async function summarize() {
    if (!state.transcript || !state.transcript.length) return;
    const div = byId("yt-ts-summary");
    div.classList.remove("yt-ts-hide");
    div.innerHTML = '<div class="yt-ts-loading">Summarizing...</div>';

    const keyResult = await chrome.storage.sync.get(["apiKey"]);
    if (!keyResult.apiKey) {
      div.innerHTML = '<div class="yt-ts-err">Set your OpenRouter API key in the extension popup first.</div>';
      return;
    }

    const plain = state.transcript.map((s) => s.text).join(" ").slice(0, 12000);

    try {
      const r = await chrome.runtime.sendMessage({
        action: "callOpenRouter",
        apiKey: keyResult.apiKey,
        messages: [
          { role: "system", content: "You are a helpful assistant. Summarize the following YouTube transcript concisely in bullet points." },
          { role: "user", content: `Summarize this transcript:\n\n${plain}` },
        ],
      });
      if (!r.success) throw new Error(r.error);
      const reply = r.data.choices[0].message.content;
      state.summary = reply;
      div.innerHTML = `<div class="yt-ts-sumtext">${esc(reply)}</div>`;
      byId("yt-ts-chat").classList.remove("yt-ts-hide");
    } catch (e) {
      div.innerHTML = `<div class="yt-ts-err">${esc(e.message)}</div>`;
    }
  }

  async function sendChat() {
    const input = byId("yt-ts-chatin");
    const q = input.value.trim();
    if (!q) return;
    input.value = "";

    const msgs = byId("yt-ts-chatmsgs");
    addMsg(msgs, "user", q);
    const loader = addMsg(msgs, "bot", "Thinking...");

    const keyResult = await chrome.storage.sync.get(["apiKey"]);
    if (!keyResult.apiKey) {
      loader.textContent = "Set your OpenRouter API key in the extension popup first.";
      loader.className = "yt-ts-msg yt-ts-msgerr";
      return;
    }

    const plain = state.transcript.map((s) => s.text).join(" ").slice(0, 12000);

    try {
      const r = await chrome.runtime.sendMessage({
        action: "callOpenRouter",
        apiKey: keyResult.apiKey,
        messages: [
          { role: "system", content: `You are analyzing a YouTube transcript. Answer the user's question based ONLY on this transcript.\n\nTranscript:\n${plain}` },
          { role: "user", content: q },
        ],
      });
      loader.remove();
      if (!r.success) throw new Error(r.error);
      addMsg(msgs, "bot", r.data.choices[0].message.content);
    } catch (e) {
      loader.textContent = e.message;
      loader.className = "yt-ts-msg yt-ts-msgerr";
    }
  }

  function addMsg(c, role, text) {
    const d = document.createElement("div");
    d.className = `yt-ts-msg yt-ts-msg${role}`;
    d.textContent = text;
    c.appendChild(d);
    c.scrollTop = c.scrollHeight;
    return d;
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }
})();
