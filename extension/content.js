(function () {
  "use strict";

  let state = { videoId: null, transcript: null, summary: null, messages: [], withTimestamps: false };

  function getVideoId() {
    try {
      const u = new URL(window.location.href);
      if (u.pathname === "/watch") return u.searchParams.get("v");
      if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2];
    } catch (e) {}
    return null;
  }

  function inject() {
    if (document.getElementById("yt-ts-root")) return;
    const vid = getVideoId();
    if (!vid) return;
    state.videoId = vid;

    // Find injection target: try multiple selectors
    const targets = ["#primary", "#below", "#content", "#page-manager", "#columns"];
    let target = null;
    for (const sel of targets) {
      target = document.querySelector(sel);
      if (target) break;
    }
    // Absolute fallback: inject after the video player
    if (!target) {
      const player = document.querySelector("#movie_player, #player-container, #player");
      if (player && player.parentNode) {
        target = player.parentNode;
      }
    }
    // Last resort: body itself
    if (!target) target = document.body;
    if (!target) return;

    // Build panel
    const root = document.createElement("div");
    root.id = "yt-ts-root";
    root.style.cssText =
      "margin:8px 0;font-family:Roboto,Arial,sans-serif;font-size:14px;line-height:1.5;color:#0f0f0f;";

    const bar = document.createElement("div");
    bar.id = "yt-ts-bar";
    bar.style.cssText =
      "display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid #e0e0e0;border-radius:8px;background:#fff;cursor:pointer;user-select:none;";
    bar.onmouseenter = function () { this.style.background = "#f0f0f0"; };
    bar.onmouseleave = function () { this.style.background = "#fff"; };

    const icon = document.createElement("span");
    icon.id = "yt-ts-icon";
    icon.textContent = "📝";
    icon.style.fontSize = "16px";

    const label = document.createElement("span");
    label.id = "yt-ts-label";
    label.textContent = "Transcript";
    label.style.cssText = "flex:1;font-weight:500;font-size:14px;";

    const tsLabel = document.createElement("label");
    tsLabel.style.cssText = "display:flex;align-items:center;gap:6px;font-size:13px;color:#606060;cursor:pointer;";
    const tsCheck = document.createElement("input");
    tsCheck.type = "checkbox";
    tsCheck.id = "yt-ts-tscb";
    tsLabel.appendChild(tsCheck);
    tsLabel.appendChild(document.createTextNode("Timestamps"));

    bar.appendChild(icon);
    bar.appendChild(label);
    bar.appendChild(tsLabel);
    root.appendChild(bar);

    // Body (collapsible)
    const body = document.createElement("div");
    body.id = "yt-ts-body";
    body.style.cssText =
      "display:none;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px;padding:12px;background:#fff;";

    const content = document.createElement("div");
    content.id = "yt-ts-content";
    content.style.cssText = "max-height:400px;overflow-y:auto;white-space:pre-wrap;word-wrap:break-word;font-size:13px;line-height:1.6;padding:4px 0;";
    body.appendChild(content);

    const toolbar = document.createElement("div");
    toolbar.id = "yt-ts-toolbar";
    toolbar.style.cssText = "display:none;gap:8px;padding:8px 0 0;border-top:1px solid #e0e0e0;margin-top:8px;";

    const copyBtn = document.createElement("button");
    copyBtn.id = "yt-ts-copy";
    copyBtn.textContent = "📋 Copy";
    copyBtn.style.cssText = "border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500;background:#065fd4;color:#fff;padding:6px 12px;";
    copyBtn.onclick = copyTranscript;
    toolbar.appendChild(copyBtn);

    const sumBtn = document.createElement("button");
    sumBtn.id = "yt-ts-sum";
    sumBtn.textContent = "✨ Summarize";
    sumBtn.style.cssText = "border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500;background:#065fd4;color:#fff;padding:6px 12px;";
    sumBtn.onclick = summarize;
    toolbar.appendChild(sumBtn);

    body.appendChild(toolbar);

    const summaryDiv = document.createElement("div");
    summaryDiv.id = "yt-ts-summary";
    summaryDiv.style.cssText = "display:none;border-top:1px solid #e0e0e0;margin-top:8px;padding-top:8px;";
    body.appendChild(summaryDiv);

    const chatDiv = document.createElement("div");
    chatDiv.id = "yt-ts-chat";
    chatDiv.style.cssText = "display:none;border-top:1px solid #e0e0e0;margin-top:8px;padding-top:8px;";

    const chatMsgs = document.createElement("div");
    chatMsgs.id = "yt-ts-chatmsgs";
    chatMsgs.style.cssText = "max-height:300px;overflow-y:auto;margin-bottom:8px;";
    chatDiv.appendChild(chatMsgs);

    const chatRow = document.createElement("div");
    chatRow.style.cssText = "display:flex;gap:6px;";
    const chatInput = document.createElement("input");
    chatInput.type = "text";
    chatInput.id = "yt-ts-chatin";
    chatInput.placeholder = "Ask about this video...";
    chatInput.style.cssText = "flex:1;padding:6px 10px;border:1px solid #ccc;border-radius:6px;font-size:13px;outline:none;background:#fff;color:#0f0f0f;";
    chatInput.onkeydown = function (e) { if (e.key === "Enter") sendChat(); };
    const chatSend = document.createElement("button");
    chatSend.textContent = "Send";
    chatSend.style.cssText = "border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500;background:#065fd4;color:#fff;padding:6px 12px;";
    chatSend.onclick = sendChat;
    chatRow.appendChild(chatInput);
    chatRow.appendChild(chatSend);
    chatDiv.appendChild(chatRow);
    body.appendChild(chatDiv);

    root.appendChild(body);
    target.appendChild(root);

    // Bind bar click
    bar.onclick = function () {
      if (body.style.display === "none") {
        body.style.display = "block";
        icon.textContent = "📄";
        if (!state.transcript) fetchTranscript();
      } else {
        body.style.display = "none";
        icon.textContent = "📝";
      }
    };

    tsCheck.onchange = function () {
      state.withTimestamps = this.checked;
      if (state.transcript) renderTranscript();
    };
  }

  function byId(id) { return document.getElementById(id); }
  function qs(s) { return document.querySelector(s); }

  async function fetchTranscript() {
    const el = byId("yt-ts-content");
    if (!el) return;
    el.innerHTML = '<span style="color:#606060;font-style:italic;">Loading transcript...</span>';

    try {
      const r = await chrome.runtime.sendMessage({ action: "fetchTranscript", videoId: state.videoId });
      if (!r.success) throw new Error(r.error);
      state.transcript = r.data;
      renderTranscript();
      const tb = byId("yt-ts-toolbar");
      if (tb) tb.style.display = "flex";
    } catch (e) {
      el.innerHTML = '<span style="color:#f85149;">' + esc(e.message) + "</span>";
    }
  }

  function renderTranscript() {
    const el = byId("yt-ts-content");
    if (!el || !state.transcript) return;
    const lines = state.transcript.map(function (s) {
      return state.withTimestamps ? fmtTs(s.start) + " " + s.text : s.text;
    });
    const cleaned = lines.filter(function (l, i, a) { return i === 0 || l !== a[i - 1]; });
    el.innerHTML = '<div style="padding:4px 0;">' + esc(cleaned.join("\n")) + "</div>";
  }

  function fmtTs(sec) {
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = Math.floor(sec % 60);
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }

  function copyTranscript() {
    var t = qs("#yt-ts-content div");
    if (!t) return;
    navigator.clipboard.writeText(t.textContent).then(function () {
      var btn = byId("yt-ts-copy");
      if (!btn) return;
      btn.textContent = "✅ Copied!";
      setTimeout(function () { btn.textContent = "📋 Copy"; }, 2000);
    });
  }

  async function summarize() {
    if (!state.transcript || !state.transcript.length) return;
    var div = byId("yt-ts-summary");
    if (!div) return;
    div.style.display = "block";
    div.innerHTML = '<span style="color:#606060;font-style:italic;">Summarizing...</span>';

    var keyResult = await chrome.storage.sync.get(["apiKey"]);
    if (!keyResult.apiKey) {
      div.innerHTML = '<span style="color:#f85149;">Set your OpenRouter API key in the extension popup first.</span>';
      return;
    }

    var plain = state.transcript.map(function (s) { return s.text; }).join(" ").slice(0, 12000);

    try {
      var r = await chrome.runtime.sendMessage({
        action: "callOpenRouter",
        apiKey: keyResult.apiKey,
        messages: [
          { role: "system", content: "You are a helpful assistant. Summarize the following YouTube transcript concisely in bullet points." },
          { role: "user", content: "Summarize this transcript:\n\n" + plain },
        ],
      });
      if (!r.success) throw new Error(r.error);
      var reply = r.data.choices[0].message.content;
      state.summary = reply;
      div.innerHTML = '<div style="font-size:13px;line-height:1.6;white-space:pre-wrap;">' + esc(reply) + "</div>";
      var chat = byId("yt-ts-chat");
      if (chat) chat.style.display = "block";
    } catch (e) {
      div.innerHTML = '<span style="color:#f85149;">' + esc(e.message) + "</span>";
    }
  }

  async function sendChat() {
    var input = byId("yt-ts-chatin");
    if (!input) return;
    var q = input.value.trim();
    if (!q) return;
    input.value = "";

    var msgs = byId("yt-ts-chatmsgs");
    if (!msgs) return;
    addMsg(msgs, "user", q);
    var loader = addMsg(msgs, "bot", "Thinking...");

    var keyResult = await chrome.storage.sync.get(["apiKey"]);
    if (!keyResult.apiKey) {
      loader.textContent = "Set your OpenRouter API key in the extension popup first.";
      return;
    }

    var plain = state.transcript.map(function (s) { return s.text; }).join(" ").slice(0, 12000);

    try {
      var r = await chrome.runtime.sendMessage({
        action: "callOpenRouter",
        apiKey: keyResult.apiKey,
        messages: [
          { role: "system", content: "You are analyzing a YouTube transcript. Answer the user's question based ONLY on this transcript.\n\nTranscript:\n" + plain },
          { role: "user", content: q },
        ],
      });
      loader.remove();
      if (!r.success) throw new Error(r.error);
      addMsg(msgs, "bot", r.data.choices[0].message.content);
    } catch (e) {
      loader.textContent = e.message;
    }
  }

  function addMsg(c, role, text) {
    var d = document.createElement("div");
    d.style.cssText = "padding:6px 8px;margin-bottom:4px;border-radius:6px;font-size:13px;" + (role === "user" ? "background:#f0f0f0;text-align:right;" : "");
    d.textContent = text;
    c.appendChild(d);
    c.scrollTop = c.scrollHeight;
    return d;
  }

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  // ==== Boot ====
  // Inject immediately
  setTimeout(inject, 500);
  setTimeout(inject, 2000);
  setTimeout(inject, 5000);

  // Re-inject on YouTube SPA navigation
  var lastUrl = location.href;
  setInterval(function () {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      var existing = document.getElementById("yt-ts-root");
      if (existing) existing.remove();
      state = { videoId: null, transcript: null, summary: null, messages: [], withTimestamps: false };
      setTimeout(inject, 1000);
      setTimeout(inject, 3000);
    }
  }, 500);
})();
