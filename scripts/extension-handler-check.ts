// Run: npx tsx scripts/extension-handler-check.ts
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { setImmediate } from "node:timers/promises";
import { mock } from "node:test";
import { handleExtensionSummary } from "../src/lib/extension-summary-handler";

const token = "extension-test-" + "x".repeat(32);
const input = { videoId: "aB012345_-z", title: "Video", author: "Channel", transcript: "  Transcript. \n" };
const request = (signal?: AbortSignal, accessToken = token) => new Request("https://example.test/api/extension-summary", {
  method: "POST",
  headers: { authorization: `Bearer ${accessToken}` },
  body: JSON.stringify(input),
  signal,
});
const decode = (value?: Uint8Array) => new TextDecoder().decode(value);

async function main() {
  let calls = 0;
  const summarize = async (value: typeof input, signal: AbortSignal) => {
    calls++;
    assert.deepEqual(value, { ...input, transcript: input.transcript.trim() });
    assert.equal(signal.aborted, false);
    return { summary: "Summary" };
  };
  for (const [configured, supplied, status, error] of [
    [undefined, token, 503, "Extension access is not configured."],
    ["short", token, 503, "Extension access is not configured."],
    [token, "wrong", 401, "Invalid extension token."],
    [token, "\u00e9".repeat(token.length), 401, "Invalid extension token."],
  ] as const) {
    let reads = 0;
    const req = new Request("https://example.test", {
      method: "POST", headers: { authorization: `Bearer ${supplied}` },
      body: new ReadableStream({ pull() { reads++; } }, { highWaterMark: 0 }),
      duplex: "half",
    } as RequestInit);
    const response = await handleExtensionSummary(req, configured, summarize);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.deepEqual(await response.json(), { error });
    assert.equal(reads, 0, "Authentication must precede reading the body");
  }
  assert.equal(calls, 0);
  const unicodeToken = "\u00e9".repeat(32);
  assert.deepEqual(await (await handleExtensionSummary(request(undefined, unicodeToken), unicodeToken, summarize)).json(), { summary: "Summary" });

  mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  try {
    for (const ending of ["success", "failure", "cancel", "abort", "timeout"] as const) {
      for (const rejectLate of [false, true]) {
        const upstream = new AbortController();
        const req = request(upstream.signal);
        let signal!: AbortSignal;
        let resolve!: (value: unknown) => void;
        let reject!: (reason: unknown) => void;
        const pending = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
        const response = await handleExtensionSummary(req, token, async (value, combined) => {
          assert.deepEqual(value, { ...input, transcript: input.transcript.trim() });
          signal = combined;
          return pending;
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(response.headers.get("content-type"), "application/json");
        assert.equal(response.headers.get("x-accel-buffering"), "no");
        assert.equal(response.headers.get("access-control-allow-origin"), null);
        const reader = response.body!.getReader();
        assert.equal(decode((await reader.read()).value), "\n");
        mock.timers.tick(15_000);
        assert.equal(decode((await reader.read()).value), "\n");
        assert.equal(signal.aborted, false);
        assert.equal(getEventListeners(req.signal, "abort").length, 1);

        if (ending === "cancel") await reader.cancel("reader cancelled");
        if (ending === "abort") upstream.abort("request aborted");
        if (ending === "timeout") mock.timers.tick(285_000);
        if (ending === "success") resolve({ summary: "Summary" });
        if (ending === "failure") reject(new Error("Provider failed."));

        let text = "";
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          text += decode(chunk.value);
        }
        if (ending === "success") assert.deepEqual(JSON.parse(text), { summary: "Summary" });
        if (ending === "failure") assert.deepEqual(JSON.parse(text), { error: "Provider failed." });
        if (ending === "timeout") {
          assert.deepEqual(JSON.parse(text), { error: "Summary timed out." });
          assert.equal(signal.reason.name, "TimeoutError");
        }
        assert.equal(signal.aborted, ["cancel", "abort", "timeout"].includes(ending));
        if (ending === "cancel") assert.equal(signal.reason, "reader cancelled");
        if (ending === "abort") assert.equal(signal.reason, "request aborted");
        assert.equal(getEventListeners(req.signal, "abort").length, 0);
        if (rejectLate) reject(new Error("Late provider failure"));
        else resolve({ summary: "Late result" });
        await setImmediate();
        mock.timers.tick(600_000);
        upstream.abort();
        assert.equal((await reader.read()).done, true);
        assert.equal(signal.aborted, ["cancel", "abort", "timeout"].includes(ending), "Completed responses must clear their timeout and request listener");
      }
    }

    const upstream = new AbortController();
    upstream.abort();
    const req = request(upstream.signal);
    const before = calls;
    const response = await handleExtensionSummary(req, token, summarize);
    assert.equal(await response.text(), "");
    assert.equal(calls, before, "An already-aborted request must not start the provider");
    assert.equal(getEventListeners(req.signal, "abort").length, 0);

    const cooperative = await handleExtensionSummary(request(), token, (_value, signal) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    mock.timers.tick(300_000);
    assert.deepEqual(await cooperative.json(), { error: "Summary timed out." });
    await setImmediate();
  } finally {
    mock.timers.reset();
  }
  console.log("Extension handler checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
