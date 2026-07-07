(function () {
  "use strict";

  // ===== State =====
  const state = {
    videoId: null,
    transcript: null,
    summary: null,
    messages: [],
    withTimestamps: false,
    initialized: false
  };

  // ===== Utilities =====
  const byId = (id) => document.getElementById(id);
  const qs = (sel, root = document) => root.querySelector(sel);

  const waitFor = (selector, root = document, timeout = 10000) => {
    return new Promise((resolve, reject) => {
      const el = qs(selector, root);
      if (el) return resolve(el);
      const observer = new MutationObserver(() => {
        const found = qs(selector, root);
        if (found) {
          observer.disconnect();
          resolve(found);
        }
      });
      observer.observe(root, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); reject(new Error("Timeout waiting for " + selector)); }, timeout);
    });
  };

  const getVideoId = () => {
    try {
      const u = new URL(window.location.href);
      if (u.pathname === "/watch") return u.searchParams.get("v");
      if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2];
    } catch (e) {}
    return null;
  };

  const fmtTs = (sec) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const esc = (s) => {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  };

  // ===== API Calls =====
  const api = {
    fetchTranscript: async (videoId) => {
      const res = await fetch(`https://youtubetranscript.com/api?vid=${videoId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },

    callOpenRouter: async (apiKey, messages, model = "meta-llama/llama-3.2-3b-instruct:free") => {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, messages, max_tokens: 2048 }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${res.status}`);
      }
      return res.json();
    }
  };

  // ===== UI Functions =====
  function buildPanel() {
    if (qs("#yt-ts-root")) return;

    const targets = ["#primary", "#below", "#content", "#page-manager", "#columns"];
    let target = null;
    for (const sel of targets) {
      target = qs(sel);
      if (target) break;
    }
    if (!target) {
      const player = qs("#movie_player, #player-container, #player");
      if (player?.parentNode) target = player.parentNode;
    }
    if (!target) target = document.body;
    if (!target) return;

    const root = document.createElement("div");
    root.id = "yt-ts-root";
    root.innerHTML = `
      <div class="yt-ts-bar" id="yt-ts-bar">
        <span class="yt-ts-icon" id="yt-ts-icon">📝</span>
        <span class="yt-ts-label" id="yt-ts-label">Transcript</span>
        <label class="yt-ts-tslabel">
          <input type="checkbox" id="yt-ts-tscb"> Timestamps
        </label>
      </div>
      <div class="yt-ts-body yt-ts-hide" id="yt-ts-body">
        <div class="yt-ts-content" id="yt-ts-content"></div>
        <div class="yt-ts-toolbar yt-ts-hide" id="yt-ts-toolbar">
          <button class="yt-ts-btn yt-ts-btn-sm" id="yt-ts-copy">📋 Copy</button>
          <button class="yt-ts-btn yt-ts-btn-sm" id="yt-ts-sum">✨ Summarize</button>
        </div>
        <div class="yt-ts-summary yt-ts-hide" id="yt-ts-summary"></div>
        <div class="yt-ts-chat yt-ts-hide" id="yt-ts-chat">
          <div class="yt-ts-chatmsgs" id="yt-ts-chatmsgs"></div>
          <div class="yt-ts-chatrow">
            <input type="text" class="yt-ts-chatin" id="yt-ts-chatin" placeholder="Ask about this video...">
            <button class="yt-ts-btn yt-ts-btn-sm" id="yt-ts-chatsend">Send</button>
          </div>
        </div>
      </div>
    `;

    const container = document.createElement("div");
    container.id = "yt-ts-root";
    container.appendChild(root.firstElementChild);
    target.appendChild(container);
  }

  function destroyPanel() {
    const existing = qs("#yt-ts-root");
    if (existing) existing.remove();
  }

  function toggleBody() {
    const body = qs("#yt-ts-body");
    const icon = qs("#yt-ts-icon");
    if (!body) return;
    const hidden = body.classList.toggle("yt-ts-hide");
    if (icon) icon.textContent = hidden ? "📝" : "📄";
    if (!hidden && !state.transcript) fetchTranscript();
  }

  function renderTranscript() {
    const el = qs("#yt-ts-content");
    if (!el || !state.transcript) return;
    const lines = state.transcript.map(s => state.withTimestamps ? `${fmtTs(s.start)} ${s.text}` : s.text);
    const cleaned = lines.filter((l, i, a) => i === 0 || l !== a[i - 1]);
    el.innerHTML = `<div class="yt-ts-text">${esc(cleaned.join("\n"))}</div>`;
  }

  async function fetchTranscript() {
    const el = qs("#yt-ts-content");
    if (!el) return;
    el.innerHTML = '<div class="yt-ts-loading">Loading transcript...</div>';
    try {
      const data = await api.fetchTranscript(state.videoId);
      state.transcript = data;
      renderTranscript();
      const tb = qs("#yt-ts-toolbar");
      if (tb) tb.classList.remove("yt-ts-hide");
    } catch (e) {
      el.innerHTML = `<div class="yt-ts-err">${esc(e.message)}</div>`;
    }
  }

  async function summarize() {
    if (!state.transcript?.length) return;
    const div = qs("#yt-ts-summary");
    div.classList.remove("yt-ts-hide");
    div.innerHTML = '<div class="yt-ts-loading">Summarizing...</div>';

    const keyResult = await chrome.storage.sync.get(["apiKey"]);
    if (!keyResult.apiKey) {
      div.innerHTML = '<div class="yt-ts-err">Set your OpenRouter API key in the extension popup first.</div>';
      return;
    }

    const plain = state.transcript.map(s => s.text).join(" ").slice(0, 12000);
    try {
      const res = await api.callOpenRouter(keyResult.apiKey, [
        { role: "system", content: "You are a helpful assistant. Summarize the following YouTube transcript concisely in bullet points." },
        { role: "user", content: `Summarize this transcript:\n\n${plain}` }
      ]);
      const reply = res.choices[0].message.content;
      state.summary = reply;
      div.innerHTML = `<div class="yt-ts-sumtext">${esc(reply)}</div>`;
      qs("#yt-ts-chat")?.classList.remove("yt-ts-hide");
    } catch (e) {
      div.innerHTML = `<div class="yt-ts-err">${esc(e.message)}</div>`;
    }
  }

  async function sendChat() {
    const input = qs("#yt-ts-chatin");
    if (!input) return;
    const q = input.value.trim();
    if (!q) return;
    input.value = "";

    const msgs = qs("#yt-ts-chatmsgs");
    addMsg(msgs, "user", q);
    const loader = addMsg(msgs, "bot", "Thinking...");

    const keyResult = await chrome.storage.sync.get(["apiKey"]);
    if (!keyResult.apiKey) {
      loader.textContent = "Set your OpenRouter API key in the extension popup first.";
      return;
    }

    const plain = state.transcript.map(s => s.text).join(" ").slice(0, 12000);
    try {
      const res = await api.callOpenRouter(keyResult.apiKey, [
        { role: "system", content: `You are analyzing a YouTube transcript. Answer the user's question based ONLY on this transcript.\n\nTranscript:\n${plain}` },
        { role: "user", content: q }
      ]);
      loader.remove();
      addMsg(msgs, "bot", res.choices[0].message.content);
    } catch (e) {
      loader.textContent = e.message;
    }
  }

  function addMsg(container, role, text) {
    const d = document.createElement("div");
    d.className = `yt-ts-msg yt-ts-msg${role}`;
    d.textContent = text;
    container.appendChild(d);
    container.scrollTop = container.scrollHeight;
    return d;
  }

  // ===== Event Binding =====
  function bindEvents() {
    const bar = qs("#yt-ts-bar");
    if (bar) bar.onclick = toggleBody;
    const tsCb = qs("#yt-ts-tscb");
    if (tsCb) tsCb.onchange = e => { state.withTimestamps = e.target.checked; if (state.transcript) renderTranscript(); };
    qs("#yt-ts-copy")?.addEventListener("click", copyTranscript);
    qs("#yt-ts-sum")?.addEventListener("click", summarize);
    qs("#yt-ts-chatsend")?.addEventListener("click", sendChat);
    qs("#yt-ts-chatin")?.addEventListener("keydown", e => { if (e.key === "Enter") sendChat(); });
  }

  async function copyTranscript() {
    const t = qs("#yt-ts-content .yt-ts-text");
    if (!t) return;
    await navigator.clipboard.writeText(t.textContent);
    const btn = qs("#yt-ts-copy");
    btn.textContent = "✅ Copied!";
    setTimeout(() => btn.textContent = "📋 Copy", 2000);
  }

  // ===== Navigation Handling =====
  let lastUrl = location.href;
  function checkUrlChange() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      const existing = qs("#yt-ts-root");
      if (existing) existing.remove();
      state.videoId = null;
      state.transcript = null;
      state.summary = null;
      state.messages = [];
      state.withTimestamps = false;
      state.initialized = false;
      setTimeout(init, 500);
    }
  }

  // ===== Init =====
  async function init() {
    if (state.initialized) return;

    const vid = getVideoId();
    if (!vid) return;

    state.videoId = vid;
    state.initialized = true;

    buildPanel();
    bindEvents();

    // Wait for panel to be in DOM before binding
    await new Promise(r => setTimeout(r, 0));
    bindEvents();
  }

  // Start
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Watch for SPA navigation
  setInterval(checkUrlChange, 500);
})();