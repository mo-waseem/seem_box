import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { build, stop } from "esbuild";
import { convertV4MiniflareOptions, Log, LogLevel, Miniflare, Response as MockResponse } from "miniflare";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tempRoot = "/var/folders/zn/s05tnpk52694tyycw4_k8tdh0000gn/T/opencode";
let stage = "build";

async function main() {
  const temp = await mkdtemp(join(tempRoot, "auth-worker-"));
  let mf;
  try {
    const scriptPath = join(temp, "worker.mjs");
    // The main binding uses the exact production class. Only the alarm probe
    // exposes test storage controls; it inherits the production alarm handler.
    await build({
      stdin: {
        resolveDir: root,
        sourcefile: "auth-worker-harness.mjs",
        contents: `
          import { AuthObject } from "./src/cloudflare/auth-object.ts";
          export { AuthObject };
          export class AlarmProbe extends AuthObject {
            constructor(state, env) {
              super(state, env);
              this.testStorage = state.storage;
            }
            async fetch(request) {
              const path = new URL(request.url).pathname;
              if (path === "/__expire") {
                const flows = await this.testStorage.list({ prefix: "flow:" });
                const entries = Object.fromEntries([...flows].map(([key, flow]) =>
                  [key, { ...flow, expiresAt: Date.now() - 1 }]));
                await this.testStorage.put(entries);
                await this.testStorage.setAlarm(Date.now() + 100);
                return Response.json({ armed: true });
              }
              if (path === "/__inspect") {
                return Response.json({
                  flows: (await this.testStorage.list({ prefix: "flow:" })).size,
                  alarm: await this.testStorage.getAlarm(),
                  hasTokens: Boolean(await this.testStorage.get("tokens")),
                  now: Date.now(),
                });
              }
              return super.fetch(request);
            }
          }
          export default {
            fetch(request, env) {
              const namespace = request.headers.get("x-alarm-probe") === "1"
                ? env.ALARM_PROBE : env.SEEM_BOX_AUTH;
              return namespace.get(namespace.idFromName("owner")).fetch(request);
            },
          };
        `,
      },
      bundle: true,
      platform: "browser",
      format: "esm",
      outfile: scriptPath,
      logLevel: "silent",
    });

    let approved = false;
    let polls = 0;
    let exchanges = 0;
    let refreshes = 0;
    let active = 0;
    let maximumActive = 0;
    let unexpectedOutbound = 0;
    // Miniflare 5 exposes the requested durableObjects syntax via its converter.
    const options = convertV4MiniflareOptions({
      name: "auth-worker-check",
      rootPath: temp,
      scriptPath,
      modules: true,
      compatibilityDate: "2025-09-01",
      host: "127.0.0.1",
      port: 0,
      cf: false,
      telemetry: { enabled: false },
      log: new Log(LogLevel.ERROR),
      resourcePersistencePath: join(temp, "storage"),
      durableObjects: {
        SEEM_BOX_AUTH: { className: "AuthObject", useSQLite: true },
        ALARM_PROBE: { className: "AlarmProbe", useSQLite: true },
      },
      // Every outbound fetch is intercepted. Unexpected traffic is rejected,
      // never forwarded to the network, and fails the final assertion.
      outboundService: async (request) => {
        active++;
        maximumActive = Math.max(maximumActive, active);
        try {
          await sleep(30);
          const url = new URL(request.url);
          if (url.origin === "https://auth.openai.com" && request.method === "POST") {
            if (url.pathname === "/api/accounts/deviceauth/usercode") {
              return MockResponse.json({ device_auth_id: "SYNTHETIC-device", user_code: "TEST-CODE", interval: 1 });
            }
            if (url.pathname === "/api/accounts/deviceauth/token") {
              polls++;
              return approved
                ? MockResponse.json({ authorization_code: "SYNTHETIC-code", code_verifier: "SYNTHETIC-verifier" })
                : MockResponse.json({ error: "SYNTHETIC-pending" }, { status: 403 });
            }
            if (url.pathname === "/oauth/token") {
              const form = new URLSearchParams(await request.text());
              if (form.get("grant_type") === "refresh_token") refreshes++;
              else if (form.get("grant_type") === "authorization_code") exchanges++;
              else {
                unexpectedOutbound++;
                return new MockResponse(null, { status: 400 });
              }
              return MockResponse.json({
                access_token: `SYNTHETIC-access-${exchanges}-${refreshes}`,
                refresh_token: `SYNTHETIC-refresh-${exchanges}-${refreshes}`,
                expires_in: 3600,
              });
            }
          }
          unexpectedOutbound++;
          return new MockResponse(null, { status: 502 });
        } finally {
          active--;
        }
      },
    });
    const call = async (operation, probe = false, path = "/") => {
      const response = await mf.dispatchFetch(`http://auth.test${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-alarm-probe": probe ? "1" : "0" },
        body: JSON.stringify(operation),
        signal: AbortSignal.timeout(10_000),
      });
      assert.equal(response.status, 200);
      const text = await response.text();
      if (operation.op === "start" || operation.op === "poll") {
        assert.ok(!text.includes("SYNTHETIC"), "Public responses must not contain credentials");
      }
      return JSON.parse(text);
    };

    stage = "start and pending poll in workerd";
    mf = new Miniflare(options);
    const start = await call({ op: "start" });
    assert.deepEqual(Object.keys(start).sort(), ["flowId", "intervalMs", "userCode", "verificationUrl"]);
    assert.deepEqual(await call({ op: "poll", flowId: start.flowId }), { status: "pending" });
    assert.equal(polls, 1);
    assert.equal(await call({ op: "read" }), null);

    stage = "pending flow survives full runtime restart";
    await mf.dispose();
    mf = new Miniflare(options);
    await sleep(start.intervalMs + 50);
    approved = true;
    const results = await Promise.all(Array.from({ length: 4 }, () => call({ op: "poll", flowId: start.flowId })));
    results.forEach((result) => assert.deepEqual(result, { status: "success" }));
    assert.equal(exchanges, 1);
    assert.equal(polls, 2);
    const saved = await call({ op: "read" });
    assert.ok(saved.access && saved.refresh);

    stage = "tokens and terminal result survive full runtime restart";
    await mf.dispose();
    mf = new Miniflare(options);
    assert.deepEqual(await call({ op: "read" }), saved);
    assert.deepEqual(await call({ op: "poll", flowId: start.flowId }), { status: "success" });
    assert.equal(exchanges, 1);
    assert.equal(polls, 2);

    stage = "concurrent refresh and polling serialization";
    const pending = await call({ op: "start" });
    approved = false;
    const refreshResults = await Promise.all([
      ...Array.from({ length: 6 }, () => call({ op: "refresh", current: saved })),
      call({ op: "poll", flowId: pending.flowId }),
    ]);
    assert.deepEqual(refreshResults.pop(), { status: "pending" });
    refreshResults.forEach((tokens) => assert.deepEqual(tokens, refreshResults[0]));
    assert.notEqual(refreshResults[0].refresh, saved.refresh);
    assert.equal(refreshes, 1);
    assert.equal(maximumActive, 1, "Upstream requests on the owner must be serialized");
    await mf.dispose();
    mf = new Miniflare(options);
    assert.deepEqual(await call({ op: "refresh", current: saved }), refreshResults[0]);
    assert.deepEqual(await call({ op: "read" }), refreshResults[0]);
    assert.equal(refreshes, 1, "Restarted owner must not refresh stale credentials twice");

    stage = "real workerd alarm dispatch and expiry cleanup";
    approved = true;
    const alarmFlow = await call({ op: "start" }, true);
    assert.deepEqual(await call({ op: "poll", flowId: alarmFlow.flowId }, true), { status: "success" });
    await call({ op: "start" }, true);
    const beforeAlarm = await call({}, true, "/__inspect");
    assert.equal(beforeAlarm.flows, 2);
    assert.ok(beforeAlarm.alarm > beforeAlarm.now && beforeAlarm.alarm <= beforeAlarm.now + 15 * 60_000);
    await call({}, true, "/__expire");
    const deadline = Date.now() + 5000;
    let afterAlarm;
    do {
      await sleep(50);
      afterAlarm = await call({}, true, "/__inspect");
    } while (afterAlarm.flows !== 0 && Date.now() < deadline);
    assert.equal(afterAlarm.flows, 0, "Runtime must invoke inherited production alarm handler");
    assert.equal(afterAlarm.alarm, null);
    assert.equal(afterAlarm.hasTokens, true);
    assert.equal((await call({ op: "poll", flowId: alarmFlow.flowId }, true)).status, "error");
    assert.equal(unexpectedOutbound, 0);
    console.log("Auth workerd checks passed: SQLite persistence across restarts, pending/approved flows, idempotent polls, serialized refresh, real alarms, and secret-free public responses.");
  } finally {
    try {
      await mf?.dispose();
    } finally {
      stop();
      await rm(temp, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(`Auth workerd check failed during: ${stage}.`);
  // Keep assertion values and response bodies out of logs, even synthetic ones.
  if (error instanceof Error) console.error(error.stack?.split("\n").filter((line) => line.trimStart().startsWith("at ")).join("\n"));
  process.exitCode = 1;
});
