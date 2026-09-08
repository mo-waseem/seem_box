// Run: NODE_OPTIONS=--conditions=react-server npx tsx scripts/codex-errors-check.ts
import assert from "node:assert/strict";
import { codexForbiddenError } from "../src/lib/llm/codex";

async function main() {
  const originalWarn = console.warn;
  const logs: unknown[][] = [];
  console.warn = (...args) => { logs.push(args); };
  try {
    for (const response of [
      new Response("", { status: 403, headers: { "cf-mitigated": "challenge" } }),
      new Response("<!DOCTYPE html><title>Just a moment...</title>", { status: 403, headers: { "content-type": "text/html" } }),
    ]) {
      const error = await codexForbiddenError(response);
      assert.equal(error.status, 502);
      assert.match(error.message, /browser-verification challenge/);
      assert.doesNotMatch(error.message, /subscription/);
    }
    const html = await codexForbiddenError(new Response("<html>Private gateway detail</html>", { status: 403 }));
    assert.match(html.message, /HTML access-denied/);
    assert.doesNotMatch(html.message, /Private gateway detail/);
    const denied = await codexForbiddenError(Response.json({ error: { message: "This model is not available to your account." } }, { status: 403 }));
    assert.match(denied.message, /This model is not available/);
    for (const body of ["", "Forbidden", "null", "{}", '"Forbidden"']) {
      const error = await codexForbiddenError(new Response(body, { status: 403 }));
      assert.match(error.message, /without an explanation/);
    }
    const redacted = await codexForbiddenError(Response.json({ message: "Rejected Bearer secret-token" }, { status: 403 }));
    assert.doesNotMatch(redacted.message, /secret-token/);
    assert.doesNotMatch(JSON.stringify(logs), /Private gateway detail|secret-token|This model/);
    console.log("Codex error checks passed: challenges, HTML gateways, structured errors, unknown failures, and safe diagnostics.");
  } finally {
    console.warn = originalWarn;
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
