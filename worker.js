import { authorizeAdmin } from "./src/cloudflare/admin-auth.js";
import { AppError } from "./src/lib/errors.ts";
import { handleExtensionSummary } from "./src/lib/extension-summary-handler.ts";
import { summarizeForWorker, workerAuth, workerProviderStatus } from "./src/cloudflare/summary.ts";
import settingsHTML from "./src/cloudflare/settings.html";
import settingsScript from "./src/cloudflare/settings.js";

export { AuthObject } from "./src/cloudflare/auth-object.ts";

const worker = {
  async fetch(request, env) {
    const rejection = await authorizeAdmin(request, env);
    if (rejection) return rejection;
    const path = new URL(request.url).pathname;
    const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
    try {
      if (path === "/api/extension-summary" && request.method === "POST") {
        return handleExtensionSummary(request, env.SEEM_BOX_EXTENSION_TOKEN,
          (input, signal) => summarizeForWorker(input, env, signal));
      }
      if (path === "/api/youtube-summary") {
        return json({ error: "Server-side YouTube scraping is not available on this lightweight backend. Use Youtube AI Summary on the video's YouTube page; it sends browser-retrieved captions to /api/extension-summary." }, 410);
      }
      if ((path === "/" || path === "/settings" || path === "/youtube-summary") && request.method === "GET") {
        return new Response(settingsHTML, { headers: {
          "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
          "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
          "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
        } });
      }
      if (path === "/settings.js" && request.method === "GET") {
        return new Response(settingsScript, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
      }
      if (path === "/api/auth/status" && request.method === "GET") return json(await workerProviderStatus(env));
      if (path === "/api/auth/device/start" && request.method === "POST") return json(await workerAuth(env, { op: "start" }));
      if (path === "/api/auth/device/poll" && request.method === "GET") {
        const flowId = new URL(request.url).searchParams.get("flowId");
        if (!flowId || flowId.length > 128) return json({ status: "error", message: "A valid flowId is required." }, 400);
        return json(await workerAuth(env, { op: "poll", flowId }));
      }
      if (["/api/extension-summary", "/api/auth/status", "/api/auth/device/start", "/api/auth/device/poll", "/settings", "/settings.js", "/"].includes(path)) {
        return json({ error: "Method not allowed." }, 405);
      }
      return json({ error: "Not found." }, 404);
    } catch (error) {
      const status = error instanceof AppError ? error.status : 500;
      const message = error instanceof AppError ? error.message : "Unexpected backend error.";
      return json(path === "/api/auth/device/poll" ? { status: "error", message } : { error: message }, status);
    }
  },
};

export default worker;
