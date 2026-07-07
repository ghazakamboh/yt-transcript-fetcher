chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "fetchTranscript") {
    fetch(`https://youtubetranscript.com/api?vid=${request.videoId}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === "callOpenRouter") {
    fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: request.model || "meta-llama/llama-3.2-3b-instruct:free",
        messages: request.messages,
        max_tokens: 2048,
      }),
    })
      .then((r) => {
        if (!r.ok)
          return r.json().then((e) => {
            const msg =
              e.error?.message || e.message || e.error || JSON.stringify(e);
            return Promise.reject(new Error(msg));
          });
        return r.json();
      })
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) =>
        sendResponse({ success: false, error: err.message || String(err) })
      );
    return true;
  }
});
