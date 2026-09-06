import "server-only";
import { AppError } from "@/lib/errors";
import { refreshCodexTokens } from "./device-auth";
import { readCodexTokens, writeCodexTokens, type CodexTokens } from "./token-store";
import { cloudflareAuth, usesCloudflareAuth } from "./auth-cloudflare";

const RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const MODELS_URL = "https://chatgpt.com/backend-api/codex/models?client_version=1.0.0";

export const CODEX_MODEL = process.env.SEEM_BOX_CODEX_MODEL?.trim() || "gpt-5.4";

let modelCache: { accountID: string | null; expiresAt: number; models: string[] } | null = null;

export async function listCodexModels(): Promise<string[]> {
  const tokens = await requireTokens();
  if (modelCache && modelCache.accountID === tokens.accountID && modelCache.expiresAt > Date.now()) {
    return modelCache.models;
  }
  const response = await fetch(MODELS_URL, {
    headers: requestHeaders(tokens),
  });
  if (!response.ok) {
    const detail = await errorDetail(response);
    throw new AppError(`Could not load ChatGPT models (HTTP ${response.status})${detail ? `: ${detail}` : "."}`, 502);
  }
  const payload = (await response.json()) as unknown;
  const models = collectModelIDs(payload);
  modelCache = { accountID: tokens.accountID, expiresAt: Date.now() + 5 * 60_000, models };
  return models;
}

export async function resolveCodexModel(requestedModel?: string): Promise<string> {
  const requested = requestedModel?.trim();
  const candidate = requested || CODEX_MODEL;
  let models: string[];
  try {
    models = await listCodexModels();
  } catch {
    return candidate;
  }
  if (requested) {
    if (!models.includes(requested)) {
      throw new AppError(`Model ${requested} is not available for this ChatGPT account.`, 400);
    }
    return requested;
  }
  if (models.includes(candidate)) return candidate;
  const preferred = ["gpt-5.4", "gpt-5.6-sol", "gpt-5.5"];
  return preferred.find((model) => models.includes(model)) ?? models[0] ?? candidate;
}

export async function codexComplete({ system, user, model = CODEX_MODEL }: { system: string; user: string; model?: string }): Promise<string> {
  let tokens = await requireTokens();
  let response = await requestResponses(tokens, system, user, model);
  if (response.status === 401) {
    tokens = await forceRefresh(tokens);
    response = await requestResponses(tokens, system, user, model);
  }
  if (response.status === 403) {
    throw new AppError(
      "ChatGPT rejected the request (403). Your subscription may not include this feature, or a Cloudflare challenge is blocking the request. Try again or reconnect in Settings.",
      502,
    );
  }
  if (!response.ok) {
    const detail = await errorDetail(response);
    throw new AppError(`ChatGPT backend error (HTTP ${response.status})${detail ? `: ${detail}` : "."}`, 502);
  }
  return readSSE(response);
}

async function requireTokens(): Promise<CodexTokens> {
  const tokens = await readCodexTokens();
  if (!tokens) {
    throw new AppError("ChatGPT is not connected. Open Settings and connect via device code.", 400);
  }
  if (Date.now() >= tokens.expiresAt - 60_000) {
    return forceRefresh(tokens);
  }
  return tokens;
}

async function forceRefresh(current: CodexTokens): Promise<CodexTokens> {
  if (usesCloudflareAuth()) return cloudflareAuth({ op: "refresh", current });
  const fresh = await refreshCodexTokens(current.refresh);
  const merged: CodexTokens = {
    ...fresh,
    accountID: fresh.accountID ?? current.accountID,
    planType: fresh.planType ?? current.planType,
  };
  await writeCodexTokens(merged);
  return merged;
}

async function requestResponses(tokens: CodexTokens, system: string, user: string, model: string): Promise<Response> {
  return fetch(RESPONSES_URL, {
    method: "POST",
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

function requestHeaders(tokens: CodexTokens): Record<string, string> {
  return {
    Authorization: `Bearer ${tokens.access}`,
    "chatgpt-account-id": tokens.accountID ?? "",
    "Content-Type": "application/json",
    "OpenAI-Beta": "responses=experimental",
    originator: "codex_cli_rs",
    "User-Agent": "codex_cli_rs/1.0.0",
  };
}

function collectModelIDs(value: unknown): string[] {
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

async function errorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    try {
      const data = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
      if (typeof data.error === "string") return data.error;
      if (data.error?.message) return data.error.message;
      if (data.message) return data.message;
    } catch {
      const snippet = text.slice(0, 300).replace(/\s+/g, " ").trim();
      if (snippet) return snippet;
    }
  } catch {
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

async function readSSE(response: Response): Promise<string> {
  const body = response.body;
  if (!body) throw new AppError("ChatGPT backend returned an empty stream.", 502);
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";
  let failure: string | null = null;

  const handleLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    try {
      const event = JSON.parse(payload) as StreamEvent;
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
        output += event.delta;
      } else if (event.type === "response.failed") {
        failure = event.response?.error?.message ?? "The model response failed.";
      } else if (event.type === "error") {
        failure = event.message ?? "The model stream reported an error.";
      }
    } catch {
      return;
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      handleLine(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }
  }
  handleLine(buffer);

  if (failure && !output) throw new AppError(failure, 502);
  if (!output.trim()) throw new AppError("The model returned no content.", 502);
  return output;
}
