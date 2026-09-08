import "server-only";
import { AppError } from "../errors";
import { refreshCodexTokens } from "./device-auth";
import { readCodexTokens, writeCodexTokens, type CodexTokens } from "./token-store";
import { cloudflareAuth, usesCloudflareAuth } from "./auth-cloudflare";
import { codexForbiddenError, collectModelIDs, errorDetail, readBoundedText, readSSE, requestHeaders, requestResponses } from "./codex-http";
export { codexForbiddenError } from "./codex-http";

export const CODEX_MODEL = process.env.SEEM_BOX_CODEX_MODEL?.trim() || "gpt-5.4";
let modelCache: { accountID: string | null; expiresAt: number; models: string[] } | null = null;

export async function listCodexModels(): Promise<string[]> {
  const tokens = await requireTokens();
  if (modelCache && modelCache.accountID === tokens.accountID && modelCache.expiresAt > Date.now()) return modelCache.models;
  const response = await fetch("https://chatgpt.com/backend-api/codex/models?client_version=1.0.0", { headers: requestHeaders(tokens) });
  if (response.status === 403) throw await codexForbiddenError(response);
  if (!response.ok) {
    const detail = await errorDetail(response);
    throw new AppError(`Could not load ChatGPT models (HTTP ${response.status})${detail ? `: ${detail}` : "."}`, 502);
  }
  const models = collectModelIDs(JSON.parse(await readBoundedText(response)));
  modelCache = { accountID: tokens.accountID, expiresAt: Date.now() + 5 * 60_000, models };
  return models;
}

export async function resolveCodexModel(requestedModel?: string): Promise<string> {
  const requested = requestedModel?.trim();
  const candidate = requested || CODEX_MODEL;
  let models: string[];
  try { models = await listCodexModels(); } catch { return candidate; }
  if (requested) {
    if (!models.includes(requested)) throw new AppError(`Model ${requested} is not available for this ChatGPT account.`, 400);
    return requested;
  }
  if (models.includes(candidate)) return candidate;
  return ["gpt-5.4", "gpt-5.6-sol", "gpt-5.5"].find((model) => models.includes(model)) ?? models[0] ?? candidate;
}

export async function codexComplete({ system, user, model = CODEX_MODEL, signal }: { system: string; user: string; model?: string; signal?: AbortSignal }): Promise<string> {
  let tokens = await requireTokens();
  let response = await requestResponses(tokens, system, user, model, signal);
  if (response.status === 401) {
    await response.body?.cancel();
    tokens = await forceRefresh(tokens);
    response = await requestResponses(tokens, system, user, model, signal);
  }
  if (response.status === 403) throw await codexForbiddenError(response, signal);
  if (!response.ok) {
    const detail = await errorDetail(response, signal);
    throw new AppError(`ChatGPT backend error (HTTP ${response.status})${detail ? `: ${detail}` : "."}`, 502);
  }
  return readSSE(response, signal);
}

async function requireTokens(): Promise<CodexTokens> {
  const tokens = await readCodexTokens();
  if (!tokens) throw new AppError("ChatGPT is not connected. Open Settings and connect via device code.", 400);
  return Date.now() >= tokens.expiresAt - 60_000 ? forceRefresh(tokens) : tokens;
}

async function forceRefresh(current: CodexTokens): Promise<CodexTokens> {
  if (usesCloudflareAuth()) return cloudflareAuth({ op: "refresh", current });
  const fresh = await refreshCodexTokens(current.refresh);
  const merged = { ...fresh, accountID: fresh.accountID ?? current.accountID, planType: fresh.planType ?? current.planType };
  await writeCodexTokens(merged);
  return merged;
}
