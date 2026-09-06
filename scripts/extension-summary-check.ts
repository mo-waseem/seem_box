// Run: NODE_OPTIONS=--conditions=react-server npx tsx scripts/extension-summary-check.ts
import assert from "node:assert/strict";
import { mock } from "node:test";
import { POST } from "../src/app/api/extension-summary/route";
import { COMPAT_MODEL } from "../src/lib/llm/compat";

async function main() {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const token = "test-extension-token-" + "x".repeat(32);
  const valid = { videoId: "aB012345_-z", title: "Video", author: "Channel", transcript: "  Transcript text. \n" };
  const summary = { summary: "Summary", takeaways: ["Takeaway"], conclusion: "Conclusion" };
  let calls = 0;
  let prompt = "";
  let providerStatus = 200;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    prompt = JSON.parse(init?.body as string).messages[1].content;
    return Response.json({ choices: [{ message: { content: JSON.stringify(summary) } }] }, { status: providerStatus });
  };
  const request = (body: string = JSON.stringify(valid), authorization: string = `Bearer ${token}`, headers = {}) =>
    new Request("http://localhost/api/extension-summary", {
      method: "POST", headers: { authorization, ...headers }, body,
    });
  const check = async (req: Request, status: number) => {
    const response = await POST(req);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    if (status === 200) {
      assert.equal(response.headers.get("content-type"), "application/json");
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("x-accel-buffering"), "no");
    }
    const body = await response.json();
    if (status !== 200) assert.equal(typeof body.error, "string");
    return body;
  };
  try {
    process.env.SEEM_BOX_LLM_PROVIDER = "compat";
    delete process.env.SEEM_BOX_EXTENSION_TOKEN;
    await check(request(), 503);
    process.env.SEEM_BOX_EXTENSION_TOKEN = "short";
    await check(request(), 503);
    process.env.SEEM_BOX_EXTENSION_TOKEN = token;
    for (const auth of ["", token, `Basic ${token}`, `Bearer ${token.slice(1)}`, `Bearer ${"y".repeat(token.length)}`, `Bearer ${"é".repeat(token.length)}`]) {
      await check(request(undefined, auth), 401);
    }
    for (const body of ["{", "null", "[]", "42", '"text"', "{}"] ) {
      await check(request(body), 400);
    }
    for (const patch of [
      { videoId: "bad" }, { videoId: "abcdefghij/" }, { videoId: 123 },
      { title: null }, { title: "x".repeat(501) },
      { author: false }, { author: "x".repeat(301) },
      { transcript: null }, { transcript: " \n\t" }, { transcript: "x".repeat(500_001) },
    ]) {
      await check(request(JSON.stringify({ ...valid, ...patch })), 400);
    }
    await check(request(undefined, undefined, { "content-length": String(2 * 1024 * 1024 + 1) }), 413);
    // Actual bytes are authoritative, even with an absent or misleading Content-Length.
    for (const headers of [{}, { "content-length": "1" }]) {
      let cancelled = false;
      let chunks = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          chunks += 1;
          controller.enqueue(new TextEncoder().encode("é".repeat(64 * 1024)));
        },
        cancel() { cancelled = true; },
      });
      const req = new Request("http://localhost/api/extension-summary", {
        method: "POST", headers: { authorization: `Bearer ${token}`, ...headers }, body: stream,
        duplex: "half",
      } as RequestInit);
      await check(req, 413);
      assert.equal(cancelled, true);
      assert.ok(chunks < 20);
    }
    assert.equal(calls, 0, "Rejected requests must not reach the LLM");
    assert.deepEqual(await check(request(), 200), { ...summary, provider: "compat", model: COMPAT_MODEL });
    assert.equal(prompt, "Title: Video\nChannel: Channel\n\nTranscript:\nTranscript text.");
    await check(request(JSON.stringify({ ...valid, title: "x".repeat(500), author: "x".repeat(300), transcript: "x".repeat(500_000) })), 200);
    await check(request(JSON.stringify({ ...valid, title: "", author: "" })), 200);
    const padded = JSON.stringify(valid).padEnd(2 * 1024 * 1024, " ");
    await check(request(padded), 200);
    await check(request(padded + " "), 413);
    providerStatus = 503;
    assert.match((await check(request(), 200)).error, /Sidecar error \(HTTP 503\)/);

    mock.timers.enable({ apis: ["setInterval"] });
    for (const cancel of [false, true]) {
      for (const fail of [false, true]) {
        let finish!: (response: Response) => void;
        let started!: () => void;
        const providerStarted = new Promise<void>((resolve) => { started = resolve; });
        const deferred = new Promise<Response>((resolve) => { finish = resolve; });
        globalThis.fetch = async () => {
          started();
          return deferred;
        };
        // Fail promptly if POST or the first chunk waits for the deferred provider.
        const deadline = setTimeout(() => {
          console.error("Streaming response waited for the provider.");
          process.exit(1);
        }, 5_000);
        try {
          const response = await POST(request());
          assert.equal(response.status, 200);
          const reader = response.body!.getReader();
          const first = await reader.read();
          assert.equal(first.done, false);
          assert.equal(new TextDecoder().decode(first.value), "\n");
          await providerStarted;
          mock.timers.tick(15_000);
          assert.equal(new TextDecoder().decode((await reader.read()).value), "\n");
          if (cancel) await reader.cancel();
          finish(Response.json({ choices: [{ message: { content: JSON.stringify(summary) } }] }, { status: fail ? 503 : 200 }));
          if (cancel) {
            // Let the summarizer settle after cancellation; late enqueues would reject unhandled.
            await new Promise((resolve) => setTimeout(resolve, 25));
          } else {
            const result = JSON.parse(new TextDecoder().decode((await reader.read()).value));
            if (fail) assert.match(result.error, /Sidecar error \(HTTP 503\)/);
            else assert.deepEqual(result, { ...summary, provider: "compat", model: COMPAT_MODEL });
          }
          // A surviving heartbeat would attempt to enqueue into a closed stream.
          mock.timers.tick(30_000);
          assert.equal((await reader.read()).done, true);
        } finally {
          clearTimeout(deadline);
        }
      }
    }
    console.log("Extension summary checks passed.");
  } finally {
    mock.timers.reset();
    globalThis.fetch = originalFetch;
    for (const name of ["SEEM_BOX_EXTENSION_TOKEN", "SEEM_BOX_LLM_PROVIDER"]) {
      if (originalEnv[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[name];
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
