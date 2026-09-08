import { AppError } from "../lib/errors";
import type { AuthBindings, AuthOperation, CodexTokens } from "../lib/llm/auth-types";
import { codexForbiddenError, errorDetail, readBoundedText, readSSE, requestResponses } from "../lib/llm/codex-http";
import { summarizeTranscript, type StructuredSummary } from "../lib/llm/summary-core";

export type WorkerLLMEnv = AuthBindings & {
  SEEM_BOX_LLM_PROVIDER?: string;
  SEEM_BOX_CODEX_MODEL?: string;
  SEEM_BOX_COMPAT_BASE_URL?: string;
  SEEM_BOX_COMPAT_MODEL?: string;
  SEEM_BOX_COMPAT_API_KEY?: string;
};

export async function workerAuth<T>(env: WorkerLLMEnv, operation: AuthOperation): Promise<T> {
  const namespace = env.SEEM_BOX_AUTH;
  if (!namespace || typeof namespace.idFromName !== "function" || typeof namespace.get !== "function") {
    throw new AppError("Cloudflare authentication requires the SEEM_BOX_AUTH Durable Object binding.", 503);
  }
  try {
    const response = await namespace.get(namespace.idFromName("owner")).fetch(new Request("https://auth.internal/", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(operation),
    }));
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError(response.status === 502 ? "OpenAI authentication failed. Try again or reconnect ChatGPT." : "Cloudflare authentication storage is unavailable. Try again.", response.status === 502 ? 502 : 503);
    }
    return JSON.parse(await readBoundedText(response)) as T;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Cloudflare authentication storage is unavailable. Try again.", 503);
  }
}

function pickProvider(env: WorkerLLMEnv, tokens: CodexTokens | null): "codex" | "compat" | null {
  const pref = env.SEEM_BOX_LLM_PROVIDER?.trim().toLowerCase();
  if (pref === "codex" || pref === "compat") return pref;
  return tokens ? "codex" : env.SEEM_BOX_COMPAT_BASE_URL?.trim() ? "compat" : null;
}

function compatBaseURL(env: WorkerLLMEnv): string {
  try {
    const url = new URL(env.SEEM_BOX_COMPAT_BASE_URL?.trim() || "");
    const host = url.hostname.replace(/\.$/, "");
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
        host === "localhost" || host.endsWith(".localhost") || /^127\./.test(host) || host === "0.0.0.0" || host === "[::]" || host === "[::1]" || host.startsWith("[::ffff:")) throw new Error();
    return url.href.replace(/\/+$/, "");
  } catch {
    throw new AppError("SEEM_BOX_COMPAT_BASE_URL must be an explicit remote HTTPS URL without credentials, query, or fragment.", 400);
  }
}

export async function workerProviderStatus(env: WorkerLLMEnv) {
  const tokens = env.SEEM_BOX_AUTH ? await workerAuth<CodexTokens | null>(env, { op: "read" }) : null;
  return {
    provider: pickProvider(env, tokens),
    codexModel: env.SEEM_BOX_CODEX_MODEL?.trim() || "gpt-5.4",
    compat: { baseUrl: env.SEEM_BOX_COMPAT_BASE_URL?.trim() ? compatBaseURL(env) : "", model: env.SEEM_BOX_COMPAT_MODEL?.trim() || "gpt-4o-mini", apiKeySet: Boolean(env.SEEM_BOX_COMPAT_API_KEY?.trim()) },
    codex: { loggedIn: tokens !== null, planType: tokens?.planType ?? null, accountID: tokens?.accountID ?? null, expiresAt: tokens?.expiresAt ?? null },
  };
}

export async function summarizeForWorker(input: { title: string; author: string; transcript: string }, env: WorkerLLMEnv, signal: AbortSignal): Promise<StructuredSummary & { provider: "codex" | "compat"; model: string }> {
  signal.throwIfAborted();
  let tokens = env.SEEM_BOX_AUTH ? await workerAuth<CodexTokens | null>(env, { op: "read" }) : null;
  const provider = pickProvider(env, tokens);
  if (!provider) throw new AppError("No LLM provider is ready. Connect ChatGPT or configure SEEM_BOX_COMPAT_BASE_URL.", 400);
  const model = provider === "codex" ? env.SEEM_BOX_CODEX_MODEL?.trim() || "gpt-5.4" : env.SEEM_BOX_COMPAT_MODEL?.trim() || "gpt-4o-mini";
  const baseURL = provider === "compat" ? compatBaseURL(env) : "";
  const structured = await summarizeTranscript(input, async ({ system, user }) => {
    signal.throwIfAborted();
    if (provider === "codex") {
      if (!tokens) throw new AppError("ChatGPT is not connected. Open Settings and connect via device code.", 400);
      if (Date.now() >= tokens.expiresAt - 60_000) tokens = await workerAuth<CodexTokens>(env, { op: "refresh", current: tokens });
      signal.throwIfAborted();
      let response = await requestResponses(tokens, system, user, model, signal);
      if (response.status === 401) {
        await response.body?.cancel();
        signal.throwIfAborted();
        tokens = await workerAuth<CodexTokens>(env, { op: "refresh", current: tokens });
        signal.throwIfAborted();
        response = await requestResponses(tokens, system, user, model, signal);
      }
      if (response.status === 403) throw await codexForbiddenError(response, signal);
      if (!response.ok) {
        const detail = await errorDetail(response, signal);
        throw new AppError(`ChatGPT backend error (HTTP ${response.status})${detail ? `: ${detail}` : "."}`, 502);
      }
      return readSSE(response, signal);
    }
    const apiKey = env.SEEM_BOX_COMPAT_API_KEY?.trim();
    let response: Response;
    try {
      response = await fetch(`${baseURL}/v1/chat/completions`, {
        method: "POST", signal, redirect: "manual",
        headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ model, stream: false, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      });
    } catch {
      signal.throwIfAborted();
      throw new AppError("Could not reach the compatible API provider.", 502);
    }
    if (!response.ok) {
      const detail = await errorDetail(response, signal);
      throw new AppError(`Sidecar error (HTTP ${response.status})${detail ? `: ${detail}` : "."}`, 502);
    }
    const text = await readBoundedText(response, signal);
    let data: { choices?: { message?: { content?: unknown } }[] } | null;
    try { data = JSON.parse(text); } catch { throw new AppError("The compatible API returned invalid JSON.", 502); }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new AppError("The sidecar model returned no content.", 502);
    return content.trim();
  });
  return { ...structured, provider, model };
}
