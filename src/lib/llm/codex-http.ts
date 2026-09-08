import { AppError } from "../errors";
import type { CodexTokens } from "./auth-types";

const RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";

export async function codexForbiddenError(response: Response, signal?: AbortSignal): Promise<AppError> {
  const contentType = response.headers.get("content-type") ?? "";
  const challengeHeader = response.headers.get("cf-mitigated") === "challenge";
  let text = "";
  try { text = await readBoundedText(response, signal, 64 * 1024, true); } catch { signal?.throwIfAborted(); }
  const html = contentType.includes("text/html") || /^\s*<!doctype html|^\s*<html/i.test(text);
  const challenge = challengeHeader || (html && /cf-chl-|\/cdn-cgi\/challenge-platform\/|Just a moment|Enable JavaScript and cookies to continue/i.test(text));
  // Do not log OAuth credentials, prompts, account IDs, or upstream response bodies.
  console.warn("[CODEX] Upstream access denied", { status: response.status, html, challenge });
  if (challenge) {
    return new AppError("ChatGPT blocked this server with a browser-verification challenge (403). Device login does not clear this challenge. Use an API provider or run the backend on a host that ChatGPT accepts.", 502);
  }
  if (html) {
    return new AppError("ChatGPT returned an HTML access-denied page (403), not an API response. This may be a network or security-gateway restriction; the response does not establish a subscription problem. Check the backend host's access to ChatGPT or use an API provider.", 502);
  }
  let detail = "";
  try {
    const data = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown } | null;
    const message = typeof data?.error === "string" ? data.error : data?.error?.message ?? data?.message;
    if (typeof message === "string") {
      detail = message.replace(/Bearer\s+[^\s"<>]+/gi, "Bearer [redacted]")
        .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted]")
        .replace(/\s+/g, " ").trim().slice(0, 400);
    }
  } catch { /* Never show raw HTML or unstructured gateway responses. */ }
  return new AppError(detail
    ? `ChatGPT denied API access (403): ${detail}`
    : "ChatGPT denied this server's API request (403) without an explanation. Login succeeded far enough to attempt the request, but account, model, or server-network access may still be restricted. Reconnecting is not a guaranteed fix.", 502);
}

export async function requestResponses(tokens: CodexTokens, system: string, user: string, model: string, signal?: AbortSignal): Promise<Response> {
  return fetch(RESPONSES_URL, {
    method: "POST",
    signal,
    headers: requestHeaders(tokens),
    body: JSON.stringify({
      model,
      instructions: system,
      input: [{ role: "user", content: [{ type: "input_text", text: user }] }],
      text: { verbosity: "medium" },
      include: ["reasoning.encrypted_content"],
      stream: true,
      store: false,
    }),
  });
}

export function requestHeaders(tokens: CodexTokens): Record<string, string> {
  return {
    Authorization: `Bearer ${tokens.access}`,
    "chatgpt-account-id": tokens.accountID ?? "",
    "Content-Type": "application/json",
    "OpenAI-Beta": "responses=experimental",
    originator: "codex_cli_rs",
    "User-Agent": "codex_cli_rs/1.0.0",
  };
}

export function collectModelIDs(value: unknown): string[] {
  const ids = new Set<string>();
  const visit = (item: unknown) => {
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const id = record.id ?? record.slug ?? record.model;
    if (typeof id === "string" && id.trim()) ids.add(id.trim());
    for (const key of ["models", "data", "items", "results", "available"]) {
      if (key in record) visit(record[key]);
    }
  };
  visit(value);
  return [...ids];
}

export async function errorDetail(response: Response, signal?: AbortSignal): Promise<string> {
  try {
    const text = await readBoundedText(response, signal, 64 * 1024, true);
    try {
      const data = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
      if (typeof data.error === "string") return safeDetail(data.error);
      if (typeof data.error?.message === "string") return safeDetail(data.error.message);
      if (typeof data.message === "string") return safeDetail(data.message);
    } catch {
      const snippet = safeDetail(text);
      if (snippet) return snippet;
    }
  } catch {
    signal?.throwIfAborted();
    return "";
  }
  return "";
}

type StreamEvent = {
  type?: string;
  delta?: unknown;
  message?: string;
  response?: { error?: { message?: string } };
};

export async function readSSE(response: Response, signal?: AbortSignal): Promise<string> {
  const body = response.body;
  if (!body) throw new AppError("ChatGPT backend returned an empty stream.", 502);
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";
  let failure: string | null = null;
  let outputBytes = 0;
  const encoder = new TextEncoder();

  const handleLine = (rawLine: string) => {
    if (encoder.encode(rawLine).byteLength > 1024 * 1024) throw new AppError("ChatGPT stream line exceeded the size limit.", 502);
    const line = rawLine.trim();
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    let event: StreamEvent;
    try { event = JSON.parse(payload) as StreamEvent; } catch { return; }
    if (!event) return;
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      outputBytes += encoder.encode(event.delta).byteLength;
      if (outputBytes > 2 * 1024 * 1024) throw new AppError("ChatGPT output exceeded the size limit.", 502);
      output += event.delta;
    } else if (event.type === "response.failed") {
      failure = safeDetail(event.response?.error?.message ?? "The model response failed.");
    } else if (event.type === "error") {
      failure = safeDetail(event.message ?? "The model stream reported an error.");
    }
  };

  const abort = () => { void reader.cancel(signal?.reason).catch(() => undefined); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    for (;;) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      // Slice incoming chunks too: a single upstream chunk can contain many events.
      for (let offset = 0; offset < value.length; offset += 16 * 1024) {
        buffer += decoder.decode(value.subarray(offset, offset + 16 * 1024), { stream: true });
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex !== -1) {
          handleLine(buffer.slice(0, newlineIndex));
          buffer = buffer.slice(newlineIndex + 1);
          newlineIndex = buffer.indexOf("\n");
        }
        if (encoder.encode(buffer).byteLength > 1024 * 1024) throw new AppError("ChatGPT stream line exceeded the size limit.", 502);
      }
    }
    buffer += decoder.decode();
    handleLine(buffer);

    if (failure && !output) throw new AppError(failure, 502);
    if (!output.trim()) throw new AppError("The model returned no content.", 502);
    return output;
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function safeDetail(text: string): string {
  return text.replace(/Bearer\s+[^\s"<>]+/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted]")
    .replace(/\s+/g, " ").trim().slice(0, 300);
}

export async function readBoundedText(response: Response, signal?: AbortSignal, limit = 2 * 1024 * 1024, truncate = false): Promise<string> {
  if (!response.body) { signal?.throwIfAborted(); return ""; }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  const abort = () => { void reader.cancel(signal?.reason).catch(() => undefined); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    for (;;) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) return text + decoder.decode();
      const remaining = limit - size;
      if (value.byteLength > remaining && !truncate) throw new AppError("Upstream response exceeded the size limit.", 502);
      text += decoder.decode(value.subarray(0, remaining), { stream: true });
      size += value.byteLength;
      if (size >= limit && truncate) return text + decoder.decode();
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
