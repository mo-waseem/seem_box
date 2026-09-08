const connect = document.getElementById("connect");
const badge = document.getElementById("connection-badge");
const provider = document.getElementById("provider");
const model = document.getElementById("model");
const device = document.getElementById("device");
const userCode = document.getElementById("user-code");
const feedback = document.getElementById("feedback");
const verificationUrl = "https://auth.openai.com/codex/device";
let busy = true;
let loggedIn = false;

function message(text, kind = "pending") {
  feedback.dataset.kind = kind;
  feedback.textContent = text;
}

function errorText(data, fallback) {
  if (typeof data?.message === "string" && data.message) return data.message;
  if (typeof data?.error === "string" && data.error) return data.error;
  return fallback;
}

async function request(url, { method = "GET", signal, timeout = 20_000 } = {}) {
  const response = await fetch(url, {
    method,
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
      : AbortSignal.timeout(timeout),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(errorText(data, `Request failed (HTTP ${response.status}).`));
    error.name = "HttpError";
    throw error;
  }
  return data;
}

async function loadStatus(signal) {
  const data = await request("/api/auth/status", { signal });
  if (
    !data || !["codex", "compat", null].includes(data.provider) ||
    typeof data.codex?.loggedIn !== "boolean" ||
    typeof data.codexModel !== "string" || typeof data.compat?.model !== "string"
  ) throw new Error("Invalid connection status response.");
  signal?.throwIfAborted();
  loggedIn = data.codex.loggedIn;
  badge.textContent = loggedIn ? "Connected" : "Not connected";
  badge.dataset.connected = String(loggedIn);
  provider.textContent = data.provider === "codex" ? "ChatGPT subscription"
    : data.provider === "compat" ? "OpenAI-compatible sidecar" : "None";
  model.textContent = data.provider === "codex" ? data.codexModel
    : data.provider === "compat" ? data.compat.model : "Not configured";
  return data;
}

function unlock() {
  busy = false;
  connect.disabled = false;
  connect.textContent = loggedIn ? "Reconnect via device code" : "Connect via device code";
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    function abort() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

connect.addEventListener("click", async () => {
  if (busy) return;
  busy = true;
  connect.disabled = true;
  connect.textContent = "Connecting...";
  message("Starting device login...");
  const controller = new AbortController();
  const { signal } = controller;
  const maxDeadline = Date.now() + 15 * 60_000;
  let deadline = maxDeadline;
  const expire = () => controller.abort(new Error("This login request expired. Start again."));
  let expiryTimer = setTimeout(expire, deadline - Date.now());
  try {
    const flow = await request("/api/auth/device/start", { method: "POST", signal });
    if (
      !flow || typeof flow.flowId !== "string" || !flow.flowId ||
      typeof flow.userCode !== "string" || !flow.userCode ||
      flow.verificationUrl !== verificationUrl ||
      typeof flow.intervalMs !== "number" || !Number.isFinite(flow.intervalMs) || flow.intervalMs <= 0 ||
      (flow.expiresAt !== undefined && (typeof flow.expiresAt !== "number" || !Number.isFinite(flow.expiresAt)))
    ) throw new Error("Invalid device login response. Start again.");
    deadline = Math.min(maxDeadline, flow.expiresAt ?? maxDeadline);
    if (Date.now() >= deadline) expire();
    signal.throwIfAborted();
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(expire, deadline - Date.now());
    userCode.textContent = flow.userCode;
    device.hidden = false;
    message("Pending approval. Open the verification link and enter your code.");
    document.getElementById("verification-link").focus();
    let failures = 0;
    // Wait only after the previous request settles, never run overlapping polls.
    while (true) {
      await wait(Math.min(Math.max(1_000, flow.intervalMs), Math.max(0, deadline - Date.now())), signal);
      if (Date.now() >= deadline) expire();
      signal.throwIfAborted();
      let result;
      try {
        result = await request(`/api/auth/device/poll?flowId=${encodeURIComponent(flow.flowId)}`, {
          signal, timeout: 45_000,
        });
      } catch (error) {
        signal.throwIfAborted();
        if (error.name === "HttpError") throw error;
        failures += 1;
        if (failures >= 3) throw new Error("Could not check device login after 3 network failures. Check your connection and start again.");
        message(`Connection interrupted (${failures}/3). Retrying automatically...`);
        continue;
      }
      if (Date.now() >= deadline) expire();
      signal.throwIfAborted();
      if (!result || !["pending", "success", "error"].includes(result.status)) {
        throw new Error("Invalid device login response. Start again.");
      }
      failures = 0;
      if (result.status === "error") throw new Error(errorText(result, "Device login failed. Start again."));
      if (result.status === "pending") {
        message("Pending approval. Open the verification link and enter your code.");
        continue;
      }
      message("Approval received. Verifying the saved connection...");
      try {
        const status = await loadStatus(signal);
        if (!status.codex.loggedIn) throw new Error("Not connected.");
      } catch {
        signal.throwIfAborted();
        throw new Error("Approval received, but the connection could not be verified. Reload this page to check before trying again.");
      }
      message("ChatGPT connected. You can now return to the YouTube extension.", "success");
      break;
    }
  } catch (error) {
    message(signal.aborted ? signal.reason.message
      : error.name === "TimeoutError" ? "The request timed out. Check your connection and try again."
      : error instanceof TypeError ? "Could not reach the Worker. Check your connection and try again."
      : error.message || "Could not connect. Try again.", "error");
  } finally {
    clearTimeout(expiryTimer);
    const restoreFocus = device.contains(document.activeElement);
    device.hidden = true;
    userCode.textContent = "";
    unlock();
    if (restoreFocus) connect.focus();
  }
});

try {
  await loadStatus();
} catch {
  badge.textContent = "Status unavailable";
  provider.textContent = "Unavailable";
  model.textContent = "Unavailable";
  message("Could not load connection status. Reload to retry, or start a device login below.", "error");
} finally {
  unlock();
}
