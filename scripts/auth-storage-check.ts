import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthObject, type AuthStorage } from "../src/cloudflare/auth-object";
import { FLOW_TTL_MS, parseTokenClaims } from "../src/lib/llm/auth-oauth";
import type { AuthOperation, CodexTokens, DeviceFlow, DeviceLoginStart } from "../src/lib/llm/auth-types";
import { AppError } from "../src/lib/errors";

class Storage implements AuthStorage {
  values = new Map<string, unknown>();
  alarm: number | null = null;
  failWrite = false;
  failRead = false;
  writes: string[][] = [];
  async get<T>(key: string): Promise<T | undefined> {
    if (this.failRead) throw new Error("SECRET storage failure");
    return structuredClone(this.values.get(key)) as T | undefined;
  }
  async put(entries: Record<string, unknown>) {
    if (this.failWrite) throw new Error("SECRET write failure");
    const copy = structuredClone(entries);
    this.writes.push(Object.keys(copy));
    for (const [key, value] of Object.entries(copy)) this.values.set(key, value);
  }
  async list<T>({ prefix }: { prefix: string }): Promise<Map<string, T>> {
    return new Map([...this.values].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, structuredClone(value) as T]));
  }
  async delete(keys: string[]) {
    let count = 0;
    for (const key of keys) if (this.values.delete(key)) count++;
    return count;
  }
  async setAlarm(time: number) { this.alarm = time; }
  async deleteAlarm() { this.alarm = null; }
}

async function main() {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const originalHome = process.env.HOME;
  const originalMode = process.env.SEEM_BOX_AUTH_STORAGE;
  const contextKey = Symbol.for("__cloudflare-context__");
  const globals = globalThis as unknown as Record<symbol, unknown>;
  const originalContext = globals[contextKey];
  // Import local storage only after redirecting HOME. Never touch the real auth file.
  const home = await mkdtemp(join(tmpdir(), "seem-box-auth-test-"));
  process.env.HOME = home;
  let now = 1_800_000_000_000;
  Date.now = () => now;
  let pollStatus = 403;
  let interval: string | number = 1;
  let polls = 0;
  let exchanges = 0;
  let refreshes = 0;
  let active = 0;
  let maximumActive = 0;
  let failUpstream = false;
  let expireDuringExchange = false;
  globalThis.fetch = async (input, init) => {
    assert.ok(init?.signal, "OAuth requests must have a timeout signal");
    active++;
    maximumActive = Math.max(maximumActive, active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 2));
      if (failUpstream) throw new Error("SECRET upstream error");
      const url = String(input);
      if (url.endsWith("/usercode")) return Response.json({ device_auth_id: "SECRET-device", user_code: "PUBLIC-CODE", interval });
      if (url.endsWith("/deviceauth/token")) {
        polls++;
        return Response.json(pollStatus === 200 ? { authorization_code: "SECRET-code", code_verifier: "SECRET-verifier" } : { error: "SECRET upstream response" }, { status: pollStatus });
      }
      assert.ok(url.endsWith("/oauth/token"));
      const isRefresh = String(init.body).includes("grant_type=refresh_token");
      if (isRefresh) refreshes++;
      else exchanges++;
      if (expireDuringExchange) now += FLOW_TTL_MS;
      return Response.json({ access_token: `SECRET-access-${refreshes}-${exchanges}`, refresh_token: `SECRET-refresh-${refreshes}-${exchanges}`, expires_in: 3600 });
    } finally {
      active--;
    }
  };
  try {
    const storage = new Storage();
    let object = new AuthObject({ storage });
    const call = async (operation: AuthOperation, status = 200) => {
      const response = await object.fetch(new Request("https://auth.internal/", { method: "POST", body: JSON.stringify(operation) }));
      assert.equal(response.status, status);
      const text = await response.text();
      if (operation.op === "start" || operation.op === "poll" || status !== 200) assert.ok(!text.includes("SECRET"), "Public results must not leak secrets");
      return JSON.parse(text);
    };
    const start = await call({ op: "start" }) as DeviceLoginStart;
    assert.deepEqual(Object.keys(start).sort(), ["flowId", "intervalMs", "userCode", "verificationUrl"]);
    assert.equal(storage.alarm, now + FLOW_TTL_MS);
    assert.equal((await storage.get<DeviceFlow>(`flow:${start.flowId}`))?.expiresAt, now + FLOW_TTL_MS);
    assert.deepEqual(await call({ op: "poll", flowId: start.flowId }), { status: "pending" });
    await call({ op: "poll", flowId: start.flowId });
    assert.equal(polls, 1, "Polling is interval limited");

    // Replacement instances simulate eviction/recreation, not two live owners.
    object = new AuthObject({ storage });
    now += 1000;
    pollStatus = 200;
    const results = await Promise.all(Array.from({ length: 4 }, () => call({ op: "poll", flowId: start.flowId })));
    results.forEach((result) => assert.deepEqual(result, { status: "success" }));
    assert.equal(exchanges, 1, "Duplicate polls must not exchange twice");
    assert.ok(storage.writes.some((keys) => keys.includes("tokens") && keys.includes(`flow:${start.flowId}`)), "Token and success writes must be atomic");
    object = new AuthObject({ storage });
    const saved = await call({ op: "read" }) as CodexTokens;
    assert.ok(saved.access.startsWith("SECRET-access"));
    assert.deepEqual(await call({ op: "poll", flowId: start.flowId }), { status: "success" });

    const refreshResults = await Promise.all(Array.from({ length: 5 }, () => call({ op: "refresh", current: saved })));
    assert.equal(refreshes, 1);
    refreshResults.forEach((tokens) => assert.deepEqual(tokens, refreshResults[0]));
    assert.notEqual(refreshResults[0].refresh, saved.refresh);
    object = new AuthObject({ storage });
    assert.deepEqual(await call({ op: "refresh", current: saved }), refreshResults[0]);
    assert.equal(refreshes, 1, "Stale refresh after restart must return saved tokens");

    const next = await call({ op: "start" });
    await Promise.all([call({ op: "poll", flowId: next.flowId }), call({ op: "refresh", current: refreshResults[0] })]);
    assert.equal(refreshes, 1, "An approved login must not be overwritten by a stale refresh");
    assert.equal(maximumActive, 1, "Poll and refresh upstream work must be serialized");

    const failed = await call({ op: "start" });
    const beforeFailure = await call({ op: "read" });
    storage.failWrite = true;
    await call({ op: "poll", flowId: failed.flowId }, 503);
    assert.equal((await storage.get<DeviceFlow>(`flow:${failed.flowId}`))?.result.status, "pending");
    assert.deepEqual(await call({ op: "read" }), beforeFailure);
    await call({ op: "refresh", current: beforeFailure }, 503);
    assert.deepEqual(await call({ op: "read" }), beforeFailure);
    storage.failWrite = false;
    pollStatus = 400;
    assert.equal((await call({ op: "poll", flowId: failed.flowId })).status, "error");
    const pollCount = polls;
    object = new AuthObject({ storage });
    assert.equal((await call({ op: "poll", flowId: failed.flowId })).status, "error");
    assert.equal(polls, pollCount, "Terminal errors must survive restart");

    now += FLOW_TTL_MS;
    assert.equal((await call({ op: "poll", flowId: start.flowId })).status, "error");
    await object.alarm();
    assert.equal((await storage.list({ prefix: "flow:" })).size, 0);
    assert.equal(storage.alarm, null);
    assert.deepEqual(await call({ op: "read" }), beforeFailure, "Expiry must not delete tokens");
    for (const value of ["Infinity", -10, 1e9, "nonsense"]) {
      interval = value;
      const clamped = await call({ op: "start" });
      assert.ok(Number.isFinite(clamped.intervalMs) && clamped.intervalMs >= 1000 && clamped.intervalMs <= 60_000);
    }
    const expiring = await call({ op: "start" });
    pollStatus = 200;
    expireDuringExchange = true;
    assert.equal((await call({ op: "poll", flowId: expiring.flowId })).status, "error");
    assert.deepEqual(await call({ op: "read" }), beforeFailure);
    expireDuringExchange = false;
    failUpstream = true;
    await call({ op: "start" }, 502);
    await call({ op: "refresh", current: beforeFailure }, 502);
    failUpstream = false;

    const { readAuth, readCodexTokens, writeCodexTokens } = await import("../src/lib/llm/token-store");
    const { startDeviceLogin, pollDeviceLogin } = await import("../src/lib/llm/device-auth");
    const { cloudflareAuth } = await import("../src/lib/llm/auth-cloudflare");
    process.env.SEEM_BOX_AUTH_STORAGE = "cloudflare";
    globals[contextKey] = { env: {} };
    for (const operation of [() => readAuth(), () => writeCodexTokens(saved), () => startDeviceLogin(), () => pollDeviceLogin("unknown"), () => cloudflareAuth({ op: "refresh", current: saved })]) {
      await assert.rejects(operation, (error: unknown) => error instanceof AppError && error.status === 503 && error.message.includes("SEEM_BOX_AUTH"));
    }
    globals[contextKey] = { env: { SEEM_BOX_AUTH: {
      idFromName(name: string) { assert.equal(name, "owner"); return name; },
      get(id: unknown) { assert.equal(id, "owner"); return object; },
    } } };
    assert.deepEqual(await readCodexTokens(), beforeFailure);
    storage.failRead = true;
    await assert.rejects(readCodexTokens, (error: unknown) => error instanceof AppError && error.status === 503);
    storage.failRead = false;
    await writeCodexTokens(saved);
    assert.deepEqual(await readCodexTokens(), saved);
    const throughBinding = await startDeviceLogin();
    assert.deepEqual(await pollDeviceLogin(throughBinding.flowId), { status: "success" });

    // Exercise Codex's actual 401 path with two callers holding the same tokens.
    const { codexComplete } = await import("../src/lib/llm/codex");
    const oauthFetch = globalThis.fetch;
    const stale = await readCodexTokens();
    assert.ok(stale);
    const refreshCount = refreshes;
    globalThis.fetch = async (input, init) => {
      if (String(input).includes("/codex/responses")) {
        if (new Headers(init?.headers).get("Authorization") === `Bearer ${stale.access}`) return new Response(null, { status: 401 });
        return new Response('data: {"type":"response.output_text.delta","delta":"ok"}\n\ndata: [DONE]\n');
      }
      return oauthFetch(input, init);
    };
    assert.deepEqual(await Promise.all([codexComplete({ system: "test", user: "test" }), codexComplete({ system: "test", user: "test" })]), ["ok", "ok"]);
    assert.equal(refreshes, refreshCount + 1, "Codex 401 retries must use serialized durable refresh");
    globalThis.fetch = oauthFetch;

    process.env.SEEM_BOX_AUTH_STORAGE = "local";
    assert.deepEqual(await readAuth(), {}, "Only absent local files are logged out");
    await mkdir(join(home, ".seem_box"));
    await writeFile(join(home, ".seem_box/auth.json"), JSON.stringify({ codex: saved, otherProvider: { untouched: true } }));
    assert.deepEqual(await readCodexTokens(), saved);
    await writeCodexTokens(beforeFailure);
    assert.deepEqual(await readAuth(), { codex: beforeFailure, otherProvider: { untouched: true } });
    await writeFile(join(home, ".seem_box/auth.json"), "SECRET malformed json");
    await assert.rejects(readAuth, (error: unknown) => error instanceof AppError && error.status === 503 && !error.message.includes("SECRET"));
    await writeFile(join(home, ".seem_box/auth.json"), "{}");
    const local = await startDeviceLogin();
    assert.deepEqual(await pollDeviceLogin(local.flowId), { status: "success" });
    assert.deepEqual(await pollDeviceLogin(local.flowId), { status: "success" });
    now += FLOW_TTL_MS;
    assert.equal((await pollDeviceLogin(local.flowId)).status, "error");
    await rm(join(home, ".seem_box/auth.json"));
    await mkdir(join(home, ".seem_box/auth.json"));
    await assert.rejects(readAuth, (error: unknown) => error instanceof AppError && error.status === 503, "Local filesystem errors must not become logged out");
    const claims = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "account", chatgpt_plan_type: "plus" } })).toString("base64url");
    assert.deepEqual(parseTokenClaims(`a.${claims}.c`), { accountID: "account", planType: "plus" });
    console.log("Auth storage checks passed: persistence, expiry, retries, serialization, atomic writes, redaction, bindings, and local compatibility.");
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
    if (originalMode === undefined) delete process.env.SEEM_BOX_AUTH_STORAGE; else process.env.SEEM_BOX_AUTH_STORAGE = originalMode;
    if (originalContext === undefined) delete globals[contextKey]; else globals[contextKey] = originalContext;
    await rm(home, { recursive: true, force: true });
  }
}

main().catch(() => {
  // Assertions can contain synthetic tokens; keep output secret-free too.
  console.error("Auth storage checks failed.");
  process.exitCode = 1;
});
