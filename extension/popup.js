document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("api-key");
  const saveBtn = document.getElementById("save");
  const status = document.getElementById("status");

  chrome.storage.sync.get(["apiKey"], (result) => {
    if (result.apiKey) {
      input.value = result.apiKey;
      status.textContent = "✅ Key is saved";
      status.className = "ok";
    }
  });

  saveBtn.addEventListener("click", () => {
    const key = input.value.trim();
    if (!key) {
      status.textContent = "Please enter an API key";
      status.className = "err";
      return;
    }
    chrome.storage.sync.set({ apiKey: key }, () => {
      status.textContent = "✅ Saved!";
      status.className = "ok";
      setTimeout(() => {
        if (key === input.value.trim()) {
          status.textContent = "✅ Key is saved";
        }
      }, 2000);
    });
  });
});
