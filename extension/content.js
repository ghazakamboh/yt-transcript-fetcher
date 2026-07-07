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
    const id = getVideoId();
    if (id) {
      state.videoId = id;
      inject();
    }
  }

  document.addEventListener("yt-navigate-finish", start);
  start();

  function qs(sel) {
    return document.querySelector(sel);
  }

  function waitForElm(selector) {
    return new Promise((resolve) => {
      if (qs(selector)) return resolve(qs(selector));
      const mo = new MutationObserver(() => {
        if (qs(selector)) {
          mo.disconnect();
          resolve(qs(selector));
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    });
  }

  async function inject() {
    if (document.getElementById("yt-ts-panel")) return;

    let target;
    if (qs("#description")) {
      target = qs("#description");
    } else {
      target = await waitForElm("#description");
    }
    if (!target) return;

    const panel = document.createElement("div");
    panel.id = "yt-ts-panel";
    panel.className = "yt-ts-panel";
    panel.innerHTML = `
      <div class="yt-ts-bar">
        <button id="yt-ts-toggle" class="yt-ts-btn yt-ts-btn-primary">📝 Get Transcript</button>
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
    target.parentNode.insertBefore(panel, target.nextSibling);
    bind();
  }

  function bind() {
    byId("yt-ts-toggle").onclick = toggle;
    byId("yt-ts-tscb").onchange = (e) => {
      state.withTimestamps = e.target.checked;
      if (state.transcript) renderTranscript();
    };
    byId("yt-ts-copy").onclick = copyTranscript;
    byId("yt-ts-sum").onclick = summarize;
    byId("yt-ts-chatsend").onclick = sendChat;
    byId("yt-ts-chatin").onkeydown = (e) => {
      if (e.key === "Enter") sendChat();
    };
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function toggle() {
    const body = byId("yt-ts-body");
    const btn = byId("yt-ts-toggle");
    if (body.classList.contains("yt-ts-hide")) {
      body.classList.remove("yt-ts-hide");
      btn.textContent = "📝 Hide Transcript";
      if (!state.transcript) fetchTranscript();
    } else {
      body.classList.add("yt-ts-hide");
      btn.textContent = "📝 Get Transcript";
    }
  }

  async function fetchTranscript() {
    const el = byId("yt-ts-content");
    el.innerHTML = `<div class="yt-ts-loading">Loading transcript...</div>`;

    try {
      const r = await chrome.runtime.sendMessage({
        action: "fetchTranscript",
        videoId: state.videoId,
      });
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
    const cleaned = lines.filter(
      (l, i, a) => i === 0 || l !== a[i - 1]
    );
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
    div.innerHTML = `<div class="yt-ts-loading">Summarizing...</div>`;

    const keyResult = await chrome.storage.sync.get(["apiKey"]);
    if (!keyResult.apiKey) {
      div.innerHTML = `<div class="yt-ts-err">Set your OpenRouter API key in the extension popup first.</div>`;
      return;
    }

    const plain = state.transcript.map((s) => s.text).join(" ").slice(0, 12000);

    try {
      const r = await chrome.runtime.sendMessage({
        action: "callOpenRouter",
        apiKey: keyResult.apiKey,
        messages: [
          {
            role: "system",
            content:
              "You are a helpful assistant. Summarize the following YouTube transcript concisely in bullet points.",
          },
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
          {
            role: "system",
            content: `You are analyzing a YouTube transcript. Answer the user's question based ONLY on this transcript.\n\nTranscript:\n${plain}`,
          },
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

  function addMsg(container, role, text) {
    const div = document.createElement("div");
    div.className = `yt-ts-msg yt-ts-msg${role}`;
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }
})();
