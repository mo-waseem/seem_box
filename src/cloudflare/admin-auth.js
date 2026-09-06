// The extension endpoint has its own Bearer token. Everything else served by
// the Worker shares one private ChatGPT connection and requires the owner login.
export async function authorizeAdmin(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/extension-summary" && request.method === "POST") return null;
  const password = env.SEEM_BOX_ADMIN_PASSWORD;
  if (typeof password !== "string" || password.length < 32) {
    return new Response("Set the SEEM_BOX_ADMIN_PASSWORD Worker secret (at least 32 characters) to enable this personal app.", {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
  let supplied = "";
  try {
    const encoded = /^Basic ([A-Za-z0-9+/]+=*)$/i.exec(request.headers.get("authorization") || "")?.[1];
    if (encoded) supplied = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)));
  } catch { /* Invalid credentials receive the same challenge as missing ones. */ }
  const encoder = new TextEncoder();
  const [expected, actual] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(`admin:${password}`)),
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
  ]);
  const expectedBytes = new Uint8Array(expected);
  const actualBytes = new Uint8Array(actual);
  let difference = 0;
  for (let i = 0; i < expectedBytes.length; i++) difference |= expectedBytes[i] ^ actualBytes[i];
  if (difference !== 0) {
    return new Response("Sign in as admin to manage your ChatGPT connection.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="seem_box", charset="UTF-8"', "Cache-Control": "no-store" },
    });
  }
  // Basic credentials are ambient browser credentials, so reject cross-site writes.
  if (request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.get("origin");
    if ((origin && origin !== url.origin) || request.headers.get("sec-fetch-site") === "cross-site") {
      return new Response("Cross-site requests are not allowed.", { status: 403, headers: { "Cache-Control": "no-store" } });
    }
  }
  return null;
}
