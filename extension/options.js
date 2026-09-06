/* global chrome */
const tokenInput = document.getElementById("token");
const status = document.getElementById("status");
const ready = chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
ready.then(() => chrome.storage.local.get("token")).then(({ token }) => {
  tokenInput.value = token || "";
}).catch(() => { status.textContent = "Could not load settings. Reopen this window."; });
document.getElementById("settings").addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = tokenInput.value.trim();
  if (token.length < 32) {
    status.textContent = "Use a random pairing token of at least 32 characters.";
    return;
  }
  try {
    await ready;
    await chrome.storage.local.set({ token });
    status.textContent = "Saved. Open a YouTube video and click Summarize in the bottom-right corner.";
  } catch {
    status.textContent = "Could not save settings. Please retry.";
  }
});
