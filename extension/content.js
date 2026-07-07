console.log("YT Transcript: script loaded");

window.addEventListener("error", (e) => {
  console.log("YT Transcript error:", e.message, e.filename, e.lineno);
});

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
    const existing = document.getElementById("yt-ts-root");
    if (existing) existing.remove();

    const id = getVideoId();
    if (!id) return;

    state = { videoId: id, transcript: null, summary: null, messages: [], withTimestamps: false };
    inject();
  }

  document.addEventListener("yt-navigate-finish", start);
  start();

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

  async function inject() {
    console.log("YT Transcript: inject() called for", state.videoId);

    const targets = ["#primary", "#content", "#below", "#page-manager", "body"];
    let target = null;
    for (const sel of targets) {
      console.log("YT Transcript: trying", sel);
      try {
        target = qs(sel) || (await waitFor(sel));
      } catch (e) {
        console.log("YT Transcript: waitFor failed for", sel, e.message);
      }
      if (target) break;
    }
    if (!target) {
      console.log("YT Transcript: NO TARGET FOUND - all selectors failed");
      return;
    }
    console.log("YT Transcript: injecting into", target.id || target.tagName);

    const root = document.createElement("div");
    root.id = "yt-ts-root";
    root.className = "yt-ts-root";
    root.innerHTML = `
      <div id="yt-ts-bar" class="yt-ts-bar">
        <span id="yt-ts-bar-icon" class="yt-ts-bar-icon">📝</span>
        <span id="yt-ts-bar-label" class="yt-ts-bar-label">Transcript</span>
        <label class="yt-ts-tslabel">
          <input type="checkbox" id="yt-ts-tscb" /> Timestamps
        </label>
      </div>
      <div id="yt-ts-body" class="yt-ts-body yt-ts-hide">
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
    target.appendChild(root);
    console.log("YT Transcript: panel injected");

    byId("yt-ts-bar").onclick = togglePanel;
    byId("yt-ts-tscb").onchange = (e) => {
      state.withTimestamps = e.target.checked;
      if (state.transcript) renderTranscript();
    };
    byId("yt-ts-copy").onclick = copyTranscript;
    byId("yt-ts-sum").onclick = summarize;
    byId("yt-ts-chatsend").onclick = sendChat;
    byId("yt-ts-chatin").onkeydown = (e) => { if (e.key === "Enter") sendChat(); };
  }

  function byId(id) { return document.getElementById(id); }

  function togglePanel() {
    const body = byId("yt-ts-body");
    const icon = byId("yt-ts-bar-icon");
    if (!body) return;
    if (body.classList.contains("yt-ts-hide")) {
      body.classList.remove("yt-ts-hide");
      icon.textContent = "📄";
      if (!state.transcript) fetchTranscript();
    } else {
      body.classList.add("yt-ts-hide");
      icon.textContent = "📝";
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
