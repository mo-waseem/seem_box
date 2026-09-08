// Run: npx tsx scripts/worker-summary-check.ts
import assert from "node:assert/strict";
import { summarizeForWorker, workerProviderStatus, type WorkerLLMEnv } from "../src/cloudflare/summary";
import type { AuthOperation, CodexTokens } from "../src/lib/llm/auth-types";
import { errorDetail, readBoundedText, readSSE } from "../src/lib/llm/codex-http";

const input = { title: "Title", author: "Channel", transcript: "Transcript." };
const structured = { summary: "Summary", takeaways: ["Point"], conclusion: "Conclusion" };
const delta = (text: string) => `data: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}\n\n`;
const signal = () => new AbortController().signal;

async function main() {
  const originalFetch = globalThis.fetch;
  let tokens: CodexTokens = { access: "fake-access", refresh: "fake-refresh", accountID: "fake-account", planType: "test", expiresAt: Date.now() + 3600_000 };
  const operations: AuthOperation[] = [];
  const env: WorkerLLMEnv = { SEEM_BOX_AUTH: {
    idFromName(name) { assert.equal(name, "owner"); return name; },
    get(id) { assert.equal(id, "owner"); return { async fetch(request) {
      const operation = await request.json() as AuthOperation;
      operations.push(operation);
      if (operation.op === "refresh") tokens = { ...tokens, access: "fake-refreshed", expiresAt: Date.now() + 3600_000 };
      return Response.json(tokens);
    } }; },
  } };
  let calls = 0;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://chatgpt.com/backend-api/codex/responses");
      assert.ok(init?.signal);
      calls++;
      if (calls === 1) return new Response("unauthorized", { status: 401 });
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fake-refreshed");
      return new Response(delta(JSON.stringify(structured)));
    };
    assert.deepEqual(await summarizeForWorker(input, env, signal()), { ...structured, provider: "codex", model: "gpt-5.4" });
    assert.deepEqual(operations.map((op) => op.op), ["read", "refresh"]);
    assert.equal(calls, 2);
    operations.length = 0;
    tokens.expiresAt = Date.now();
    calls = 1;
    await summarizeForWorker({ ...input, transcript: "a".repeat(90_001) }, env, signal());
    assert.equal(calls, 6); // Four map calls and one reduce call.
    assert.deepEqual(operations.map((op) => op.op), ["read", "refresh"]);
    const status = await workerProviderStatus(env);
    assert.equal(status.codex.loggedIn, true);
    assert.doesNotMatch(JSON.stringify(status), /fake-access|fake-refresh/);

    globalThis.fetch = async () => new Response("", { status: 401 });
    operations.length = 0;
    await assert.rejects(summarizeForWorker(input, env, signal()), /HTTP 401/);
    assert.deepEqual(operations.map((op) => op.op), ["read", "refresh"]);
    globalThis.fetch = async () => new Response("<html>Just a moment</html>", { status: 403 });
    await assert.rejects(summarizeForWorker(input, env, signal()), /browser-verification challenge/);

    const compat: WorkerLLMEnv = { SEEM_BOX_LLM_PROVIDER: "compat", SEEM_BOX_COMPAT_BASE_URL: "https://api.example.test/proxy/", SEEM_BOX_COMPAT_API_KEY: "fake-key" };
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://api.example.test/proxy/v1/chat/completions");
      assert.equal(init?.redirect, "manual");
      assert.ok(init?.signal);
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fake-key");
      return Response.json({ choices: [{ message: { content: JSON.stringify(structured) } }] });
    };
    assert.deepEqual(await summarizeForWorker(input, compat, signal()), { ...structured, provider: "compat", model: "gpt-4o-mini" });
    for (const base of ["http://api.example.test", "https://127.1", "https://[::1]", "https://localhost", "https://user:pass@example.test"]) {
      await assert.rejects(summarizeForWorker(input, { ...compat, SEEM_BOX_COMPAT_BASE_URL: base }, signal()), /remote HTTPS/);
    }
    globalThis.fetch = async () => new Response("x".repeat(3 * 1024 * 1024));
    await assert.rejects(summarizeForWorker(input, compat, signal()), /size limit/);
    globalThis.fetch = async () => Response.json({ error: { message: "x".repeat(10_000) } }, { status: 500 });
    await assert.rejects(summarizeForWorker(input, compat, signal()), (error: Error) => error.message.length < 400);

    for (const providerEnv of [env, compat]) {
      const controller = new AbortController();
      let canceled = false;
      globalThis.fetch = async (_url, init) => {
        assert.equal(init?.signal, controller.signal);
        return new Response(new ReadableStream({ pull() { controller.abort(); }, cancel() { canceled = true; } }));
      };
      await assert.rejects(summarizeForWorker(input, providerEnv, controller.signal), { name: "AbortError" });
      assert.equal(canceled, true);
    }
    await assert.rejects(readSSE(new Response("x".repeat(1024 * 1024 + 1))), /line exceeded/);
    await assert.rejects(readSSE(new Response(delta("x".repeat(500_000)).repeat(5))), /output exceeded/);
    await assert.rejects(readSSE(new Response('data: {"type":"response.failed","response":{"error":{"message":"failed"}}}\n')), /failed/);
    assert.equal(await readSSE(new Response(delta("partial") + 'data: {"type":"error","message":"failed"}\n')), "partial");
    assert.equal((await errorDetail(Response.json({ message: "x".repeat(10_000) }))).length, 300);
    let canceled = false;
    const huge = () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(3 * 1024 * 1024)); }, cancel() { canceled = true; } }));
    await assert.rejects(readBoundedText(huge()), /size limit/);
    assert.equal(canceled, true);
    canceled = false;
    assert.ok((await errorDetail(huge())).length <= 300);
    assert.equal(canceled, true);
    console.log("Worker summary checks passed: providers, refresh, chunks, status, 403, cancellation, and bounds.");
  } finally { globalThis.fetch = originalFetch; }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
