// Run: node scripts/standalone-worker-check.mjs. No Next/OpenNext build required.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { build, stop } from "esbuild";
import { convertV4MiniflareOptions, Log, LogLevel, Miniflare, Response as MockResponse } from "miniflare";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let stage = "temporary storage";

async function main() {
  const parent = join(tmpdir(), "opencode");
  await mkdir(parent, { recursive: true });
  const temp = await mkdtemp(join(parent, "standalone-worker-"));
  let mf;
  let releaseProvider;
  let checks = 0;
  let requests = 0;
  let compatFailure;
  const counts = { compat: 0, start: 0, poll: 0, exchange: 0, codex: 0, unexpected: 0 };
  const secrets = ["SYNTHETIC-admin-" + "a".repeat(32), "SYNTHETIC-extension-" + "b".repeat(32),
    "SYNTHETIC-api-key", "SYNTHETIC-access", "SYNTHETIC-refresh", "SYNTHETIC-device", "SYNTHETIC-code", "SYNTHETIC-verifier"];
  const [admin, extension, apiKey, access, refresh, device, code, verifier] = secrets;
  const adminHeaders = { Authorization: `Basic ${Buffer.from(`admin:${admin}`).toString("base64")}` };
  // Disable transport compression so the initial whitespace is not buffered.
  const extensionHeaders = { Authorization: `Bearer ${extension}`, "Content-Type": "application/json", "Accept-Encoding": "identity" };
  const input = { videoId: "abcdefghijk", title: "Test title", author: "Test channel", transcript: "Browser captions supplied directly." };
  const structured = { summary: "Test summary", takeaways: ["Test point"], conclusion: "Test conclusion" };
  let approved = false;
  let mode = "success";
  let mockFailure;
  try {
    stage = "bundle real root worker";
    const scriptPath = join(temp, "worker.mjs");
    const assets = new Set([join(root, "src/cloudflare/settings.html"), join(root, "src/cloudflare/settings.js")]);
    const loaded = new Set();
    const result = await build({
      absWorkingDir: root, entryPoints: ["worker.js"], outfile: scriptPath,
      bundle: true, platform: "browser", format: "esm", metafile: true, logLevel: "silent",
      plugins: [{ name: "settings-text-only", setup(builder) {
        builder.onLoad({ filter: /settings\.(html|js)$/ }, async ({ path }) => {
          if (!assets.has(path)) return;
          loaded.add(path);
          return { contents: await readFile(path, "utf8"), loader: "text" };
        });
      } }],
    });
    assert.deepEqual(loaded, assets);
    const forbidden = /(?:^|[/\\])(?:next|react(?:-dom)?|youtubei(?:\.js)?|@opennextjs|opennext|\.open-next|server-only)(?:[/\\]|$)/i;
    const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
    for (const [path, info] of Object.entries(result.metafile.inputs)) {
      assert.ok(!forbidden.test(path) && !builtins.has(path));
      for (const entry of info.imports) assert.ok(!forbidden.test(entry.path) && !builtins.has(entry.path));
    }
    assert.ok(Object.keys(result.metafile.inputs).includes("worker.js"));
    const output = Object.values(result.metafile.outputs);
    assert.equal(output.length, 1);
    assert.deepEqual(output[0].imports, [], "Bundle must be self-contained, without external Node imports");
    assert.ok(output[0].exports.includes("AuthObject"));
    const bytes = (await stat(scriptPath)).size;
    assert.equal(bytes, output[0].bytes);
    assert.ok(bytes < 150 * 1024);
    checks++;

    const options = convertV4MiniflareOptions({
      name: "seem-box", rootPath: temp, scriptPath, modules: true,
      compatibilityDate: "2026-09-01", compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"], host: "127.0.0.1", port: 0,
      cf: false, telemetry: { enabled: false }, log: new Log(LogLevel.ERROR),
      resourcePersistencePath: join(temp, "storage"),
      durableObjects: { SEEM_BOX_AUTH: { className: "AuthObject", useSQLite: true } },
      bindings: { SEEM_BOX_ADMIN_PASSWORD: admin, SEEM_BOX_EXTENSION_TOKEN: extension,
        SEEM_BOX_AUTH_STORAGE: "cloudflare", SEEM_BOX_COMPAT_BASE_URL: "https://provider.example.test",
        SEEM_BOX_COMPAT_API_KEY: apiKey },
      // Fail closed: no request, including OAuth, can reach an external network.
      outboundService: async (request) => {
        try {
          assert.equal(request.method, "POST");
          const url = new URL(request.url);
          if (url.href === "https://provider.example.test/v1/chat/completions") {
            counts.compat++;
            assert.equal(request.headers.get("authorization"), `Bearer ${apiKey}`);
            const body = await request.json();
            assert.equal(body.model, "gpt-4o-mini");
            assert.equal(body.stream, false);
            assert.equal(body.messages.length, 2);
            assert.ok(body.messages[1].content.includes(input.transcript));
            return MockResponse.json({ choices: [{ message: { content: JSON.stringify(structured) } }] });
          }
          if (url.origin === "https://auth.openai.com") {
            if (url.pathname === "/api/accounts/deviceauth/usercode") {
              counts.start++;
              assert.ok((await request.json()).client_id);
              return MockResponse.json({ device_auth_id: device, user_code: "TEST-CODE", interval: 1 });
            }
            if (url.pathname === "/api/accounts/deviceauth/token") {
              counts.poll++;
              assert.deepEqual(await request.json(), { device_auth_id: device, user_code: "TEST-CODE" });
              return approved ? MockResponse.json({ authorization_code: code, code_verifier: verifier })
                : MockResponse.json({ error: "pending" }, { status: 403 });
            }
            if (url.pathname === "/oauth/token") {
              counts.exchange++;
              const form = new URLSearchParams(await request.text());
              assert.equal(form.get("grant_type"), "authorization_code");
              assert.equal(form.get("code"), code);
              assert.equal(form.get("code_verifier"), verifier);
              return MockResponse.json({ access_token: access, refresh_token: refresh, expires_in: 3600 });
            }
          }
          if (url.href === "https://chatgpt.com/backend-api/codex/responses") {
            counts.codex++;
            assert.equal(request.headers.get("authorization"), `Bearer ${access}`);
            const body = await request.json();
            assert.equal(body.model, "gpt-5.4");
            assert.equal(body.stream, true);
            assert.equal(body.store, false);
            assert.ok(body.input[0].content[0].text.includes(input.transcript));
            if (mode === "forbidden") return MockResponse.json({ error: { message: "Test policy denied API access." } }, { status: 403 });
            if (mode === "held") await new Promise((resolve) => { releaseProvider = resolve; });
            const text = JSON.stringify(structured);
            const events = [text.slice(0, 25), text.slice(25)].map((delta) =>
              `data: ${JSON.stringify({ type: "response.output_text.delta", delta })}\n\n`).join("") + "data: [DONE]\n\n";
            // Split across SSE line and JSON boundaries, not just whole events.
            const encoder = new TextEncoder();
            return new MockResponse(new ReadableStream({ async start(controller) {
              controller.enqueue(encoder.encode(events.slice(0, 17)));
              await sleep(20);
              controller.enqueue(encoder.encode(events.slice(17)));
              controller.close();
            } }), { headers: { "Content-Type": "text/event-stream" } });
          }
          counts.unexpected++;
          return new MockResponse(null, { status: 502 });
        } catch (error) {
          mockFailure ??= error;
          return new MockResponse(null, { status: 502 });
        }
      },
    });
    const call = async (path, expected = 200, init = {}) => {
      requests++;
      const response = await mf.dispatchFetch(`http://standalone.test${path}`, {
        headers: adminHeaders, signal: AbortSignal.timeout(10_000), ...init,
      });
      assert.equal(response.status, expected);
      assert.equal(response.headers.get("cache-control"), "no-store");
      return response;
    };
    const json = async (response) => {
      const text = await response.text();
      if (mockFailure) throw mockFailure;
      for (const secret of secrets) assert.ok(!text.includes(secret), "Public response leaked a synthetic credential");
      return JSON.parse(text);
    };
    const summary = (body = JSON.stringify(input), expected = 200, headers = extensionHeaders) =>
      call("/api/extension-summary", expected, { method: "POST", headers, body, duplex: "half" });
    mf = new Miniflare(options);

    stage = "admin gate and CSRF";
    for (const path of ["/", "/settings", "/settings.js", "/api/auth/status", "/api/auth/device/start", "/api/youtube-summary", "/unknown"]) {
      const response = await call(path, 401, { headers: {} });
      assert.match(response.headers.get("www-authenticate"), /^Basic /);
      await response.text();
    }
    for (const authorization of ["Basic !!!", `Bearer ${extension}`, `Basic ${Buffer.from("admin:wrong").toString("base64")}`]) {
      await (await call("/settings", 401, { headers: { Authorization: authorization } })).text();
    }
    for (const extra of [{ Origin: "https://other.test" }, { "Sec-Fetch-Site": "cross-site" }]) {
      await (await call("/api/auth/device/start", 403, { method: "POST", headers: { ...adminHeaders, ...extra } })).text();
    }
    checks++;

    stage = "settings assets and CSP";
    for (const path of ["/", "/settings", "/youtube-summary"]) {
      const response = await call(path);
      assert.match(response.headers.get("content-type"), /^text\/html/);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(response.headers.get("referrer-policy"), "no-referrer");
      const csp = response.headers.get("content-security-policy");
      for (const directive of ["default-src 'none'", "script-src 'self'", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'"]) assert.ok(csp.includes(directive));
      const html = await response.text();
      assert.equal(html, await readFile(join(root, "src/cloudflare/settings.html"), "utf8"));
      assert.match(html, /<script type="module" src="\/settings.js"><\/script>/);
    }
    const script = await call("/settings.js");
    assert.match(script.headers.get("content-type"), /^text\/javascript/);
    assert.equal(script.headers.get("x-content-type-options"), "nosniff");
    assert.equal(await script.text(), await readFile(join(root, "src/cloudflare/settings.js"), "utf8"));
    checks++;

    stage = "methods, missing routes and retired scraping";
    for (const [path, method] of [["/", "POST"], ["/settings", "HEAD"], ["/settings.js", "POST"],
      ["/api/auth/status", "POST"], ["/api/auth/device/start", "GET"], ["/api/auth/device/poll", "POST"],
      ["/api/extension-summary", "GET"], ["/api/extension-summary", "OPTIONS"]]) {
      await (await call(path, 405, { method })).text();
    }
    assert.deepEqual(await json(await call("/missing", 404)), { error: "Not found." });
    for (const method of ["GET", "POST", "DELETE"]) {
      assert.match((await json(await call("/api/youtube-summary", 410, { method }))).error, /scraping is not available/);
    }
    for (const query of ["", `?flowId=${"x".repeat(129)}`]) {
      assert.equal((await json(await call(`/api/auth/device/poll${query}`, 400))).status, "error");
    }
    checks++;

    stage = "extension authentication before malformed and oversized input";
    for (const headers of [{}, adminHeaders, { Authorization: "Bearer wrong" }]) {
      assert.deepEqual(await json(await summary("{", 401, headers)), { error: "Invalid extension token." });
      assert.deepEqual(await json(await summary(JSON.stringify({ ...input, transcript: "x".repeat(500_001) }), 401, headers)), { error: "Invalid extension token." });
    }
    checks++;
    stage = "malformed and oversized authenticated input";
    for (const body of ["{", "null", "[]", "{}", JSON.stringify({ ...input, videoId: "bad" }),
      JSON.stringify({ ...input, title: "x".repeat(501) }), JSON.stringify({ ...input, author: "x".repeat(301) }),
      JSON.stringify({ ...input, transcript: " " }), JSON.stringify({ ...input, transcript: 123 }),
      JSON.stringify({ ...input, transcript: "x".repeat(500_001) })]) {
      assert.equal(typeof (await json(await summary(body, 400))).error, "string");
    }
    assert.match((await json(await summary("x".repeat(2 * 1024 * 1024 + 1), 413))).error, /too large/);
    const oversizedStream = new ReadableStream({ start(controller) {
      for (let i = 0; i < 33; i++) controller.enqueue(new Uint8Array(64 * 1024).fill(32));
      controller.close();
    } });
    assert.match((await json(await summary(oversizedStream, 413))).error, /too large/);
    assert.deepEqual(counts, { compat: 0, start: 0, poll: 0, exchange: 0, codex: 0, unexpected: 0 });
    checks++;

    stage = "direct compat summary without catalog or YouTube requests";
    const disconnected = await json(await call("/api/auth/status"));
    assert.equal(disconnected.codex.loggedIn, false);
    assert.equal(disconnected.provider, "compat");
    const response = await summary();
    assert.equal(response.headers.get("content-type"), "application/json");
    assert.equal(response.headers.get("x-accel-buffering"), "no");
    const compatResult = await json(response);
    // Keep running independent Codex/persistence checks if compat regresses.
    try {
      assert.deepEqual(compatResult, { ...structured, provider: "compat", model: "gpt-4o-mini" });
      assert.deepEqual(counts, { compat: 1, start: 0, poll: 0, exchange: 0, codex: 0, unexpected: 0 });
    } catch (error) { compatFailure = error; }
    checks++;

    stage = "device start, pending poll and approval";
    const start = await json(await call("/api/auth/device/start", 200, { method: "POST" }));
    assert.deepEqual(Object.keys(start).sort(), ["flowId", "intervalMs", "userCode", "verificationUrl"]);
    assert.equal(start.userCode, "TEST-CODE");
    assert.equal(start.verificationUrl, "https://auth.openai.com/codex/device");
    assert.equal(start.intervalMs, 1000);
    const pollPath = `/api/auth/device/poll?flowId=${encodeURIComponent(start.flowId)}`;
    assert.deepEqual(await json(await call(pollPath)), { status: "pending" });
    assert.equal((await json(await call("/api/auth/status"))).codex.loggedIn, false);
    approved = true;
    await sleep(start.intervalMs + 50);
    assert.deepEqual(await json(await call(pollPath)), { status: "success" });
    assert.deepEqual(await json(await call(pollPath)), { status: "success" });
    assert.equal(counts.exchange, 1);
    assert.equal(counts.poll, 2);
    // Inspect the real namespace, not a stub or subclass, to pin the production owner key.
    const namespace = await mf.getDurableObjectNamespace("SEEM_BOX_AUTH");
    const owner = namespace.get(namespace.idFromName("owner"));
    const saved = await (await owner.fetch("https://auth.internal/", { method: "POST", body: JSON.stringify({ op: "read" }) })).json();
    assert.equal(saved.access, access);
    assert.equal(saved.refresh, refresh);
    checks++;

    stage = "Codex SSE and structured upstream 403";
    assert.deepEqual(await json(await summary()), { ...structured, provider: "codex", model: "gpt-5.4" });
    mode = "forbidden";
    const denied = await json(await summary());
    assert.deepEqual(denied, { error: "ChatGPT denied API access (403): Test policy denied API access." });
    assert.equal(counts.codex, 2);
    checks++;

    stage = "stream headers before provider completion";
    mode = "held";
    const streaming = await summary();
    const reader = streaming.body.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), "\n");
    const deadline = Date.now() + 5000;
    while (!releaseProvider && Date.now() < deadline) await sleep(10);
    assert.ok(releaseProvider);
    // Client cancellation is exercised, but the Node/workerd bridge does not
    // reliably expose upstream abort signals; do not claim propagation coverage.
    const canceled = reader.cancel();
    releaseProvider();
    releaseProvider = undefined;
    await canceled;
    reader.releaseLock();
    checks++;

    stage = "full runtime restart preserves existing owner connection";
    mode = "success";
    const before = await json(await call("/api/auth/status"));
    await mf.dispose();
    mf = new Miniflare(options);
    const after = await json(await call("/api/auth/status"));
    assert.deepEqual(after, before);
    assert.equal(after.codex.loggedIn, true);
    assert.equal(after.provider, "codex");
    assert.deepEqual(await json(await call(pollPath)), { status: "success" });
    assert.deepEqual(await json(await summary()), { ...structured, provider: "codex", model: "gpt-5.4" });
    assert.equal(counts.start, 1);
    assert.equal(counts.poll, 2);
    assert.equal(counts.exchange, 1);
    assert.equal(counts.codex, 4);
    assert.equal(counts.unexpected, 0);
    if (!compatFailure) assert.equal(counts.compat, 1);
    assert.ok(!mockFailure, "Outbound mock assertions must all pass");
    checks++;
    console.log(`Standalone worker checks: ${checks - Number(Boolean(compatFailure))}/${checks} groups passed, ${requests} HTTP requests; bundle ${bytes} bytes (${(bytes / 1024).toFixed(2)} KiB), ${Object.keys(result.metafile.inputs).length} inputs, no forbidden dependencies.`);
    console.log(`Mock outbound counts: ${JSON.stringify(counts)}. No external network or real OAuth calls.`);
    console.log("Caveats: local workerd, not deployed Cloudflare or browser execution; CSP is asserted on HTML, JS uses that document policy. Client stream cancellation exercised; upstream abort propagation is not asserted. Provider errors after streaming starts use HTTP 200 JSON errors.");
    if (compatFailure) {
      stage = "direct compat summary (expected one GPT request and a structured summary)";
      throw compatFailure;
    }
  } finally {
    releaseProvider?.();
    try { await mf?.dispose(); } finally {
      stop();
      await rm(temp, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(`Standalone worker check failed during: ${stage}.`);
  // Never print assertion values, request/response bodies, or credentials.
  if (error instanceof Error) console.error(error.stack?.split("\n").filter((line) => line.trimStart().startsWith("at ")).join("\n"));
  process.exitCode = 1;
});
