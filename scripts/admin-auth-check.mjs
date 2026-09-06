import assert from "node:assert/strict";
import test from "node:test";
import { authorizeAdmin } from "../src/cloudflare/admin-auth.js";

const password = "synthetic-admin-password-" + "x".repeat(32);
const env = { SEEM_BOX_ADMIN_PASSWORD: password };
const request = (path = "/settings", headers = {}, method = "GET") => new Request(`https://example.com${path}`, { method, headers });
const authorization = `Basic ${btoa(`admin:${password}`)}`;

test("missing configuration fails closed", async () => {
  assert.equal((await authorizeAdmin(request(), {})).status, 503);
  assert.equal((await authorizeAdmin(request(), { SEEM_BOX_ADMIN_PASSWORD: "short" })).status, 503);
});
test("settings and all account APIs require admin credentials", async () => {
  for (const path of ["/settings", "/api/auth/status", "/api/auth/device/start", "/api/auth/device/poll", "/api/auth/models", "/api/youtube-summary"]) {
    for (const auth of ["", "Basic !!!", `Basic ${btoa("admin:wrong")}`, `Bearer ${password}`]) {
      const response = await authorizeAdmin(request(path, { authorization: auth }), env);
      assert.equal(response.status, 401);
      assert.match(response.headers.get("WWW-Authenticate"), /Basic/);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    }
  }
});
test("valid owner credentials pass without exposing secrets", async () => {
  assert.equal(await authorizeAdmin(request("/settings", { authorization }), env), null);
  assert.equal(await authorizeAdmin(request("/api/auth/device/start", { authorization, origin: "https://example.com" }, "POST"), env), null);
});
test("cross-site writes with browser credentials are rejected", async () => {
  for (const headers of [{ origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" }]) {
    assert.equal((await authorizeAdmin(request("/api/auth/device/start", { authorization, ...headers }, "POST"), env)).status, 403);
  }
});
test("only the exact extension POST uses the endpoint's own token authentication", async () => {
  assert.equal(await authorizeAdmin(request("/api/extension-summary", {}, "POST"), {}), null);
  for (const [path, method] of [["/api/extension-summary", "GET"], ["/api/extension-summary/", "POST"], ["/api/extension-summary/../auth/status", "POST"]]) {
    assert.equal((await authorizeAdmin(request(path, {}, method), env)).status, 401);
  }
});
