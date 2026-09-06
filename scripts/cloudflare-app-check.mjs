// Run after npm run build:cloudflare. Uses isolated local storage and synthetic secrets.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

const dir = await mkdtemp(join(tmpdir(), "opencode", "seem-box-preview-"));
const admin = "synthetic-preview-admin-" + "a".repeat(32);
const extension = "synthetic-preview-extension-" + "b".repeat(32);
const port = process.env.SEEM_BOX_TEST_PORT || "8791";
const origin = `http://127.0.0.1:${port}`;
const worker = spawn(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "dev", "--local", "--port", port,
  "--persist-to", dir, "--var", `SEEM_BOX_ADMIN_PASSWORD:${admin}`, "--var", `SEEM_BOX_EXTENSION_TOKEN:${extension}`,
], { env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
worker.stdout.on("data", (chunk) => { output = (output + chunk).slice(-20000); });
worker.stderr.on("data", (chunk) => { output = (output + chunk).slice(-20000); });
const stopped = new Promise((resolve) => worker.once("exit", resolve));
const headers = { Authorization: `Basic ${Buffer.from(`admin:${admin}`).toString("base64")}` };
try {
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    if (worker.exitCode !== null) throw new Error("Local Worker exited before becoming ready.");
    try {
      const response = await fetch(`${origin}/api/auth/status`, { signal: AbortSignal.timeout(1000) });
      await response.body?.cancel();
      if (response.status === 401) { ready = true; break; }
    } catch { /* Wait for workerd startup. */ }
    await delay(500);
  }
  assert.ok(ready, "Local Worker should challenge unauthenticated status requests");
  const status = await fetch(`${origin}/api/auth/status`, { headers });
  assert.equal(status.status, 200);
  assert.equal((await status.json()).codex.loggedIn, false, "Empty durable storage must not use local credentials");
  const poll = await fetch(`${origin}/api/auth/device/poll?flowId=synthetic-absent-flow`, { headers });
  assert.equal(poll.status, 200);
  assert.deepEqual(await poll.json(), { status: "error", message: "This login request expired. Start again." });
  const settings = await fetch(`${origin}/settings`, { headers });
  assert.equal(settings.status, 200);
  assert.match(await settings.text(), /Connect via device code/);
  for (const [token, expected] of [["wrong", 401], [extension, 400]]) {
    const response = await fetch(`${origin}/api/extension-summary`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}",
    });
    assert.equal(response.status, expected, "Extension endpoint should use Bearer auth, not admin auth");
    await response.body?.cancel();
  }
  console.log("Cloudflare app checks passed: admin gate, durable storage, Settings, and extension authentication.");
} catch (error) {
  // Only synthetic secrets are passed on the command line, but keep even those out of logs.
  console.error(output.replaceAll(admin, "[redacted]").replaceAll(extension, "[redacted]"));
  throw error;
} finally {
  worker.kill("SIGTERM");
  const forced = setTimeout(() => worker.kill("SIGKILL"), 5000);
  await stopped;
  clearTimeout(forced);
  await rm(dir, { recursive: true, force: true });
}
