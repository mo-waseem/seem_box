import "server-only";
import { AppError } from "@/lib/errors";
import { COMPAT_BASE_URL, COMPAT_MODEL, compatComplete } from "./compat";
import { CODEX_MODEL, codexComplete, resolveCodexModel } from "./codex";
import { readCodexTokens } from "./token-store";
import { summarizeTranscript, type StructuredSummary } from "./summary-core";

export { parseStructured, type StructuredSummary } from "./summary-core";
export type ProviderID = "codex" | "compat";
export type ProviderStatus = {
  provider: ProviderID | null;
  codexModel: string;
  compat: { baseUrl: string; model: string; apiKeySet: boolean };
  codex: { loggedIn: boolean; planType: string | null; accountID: string | null; expiresAt: number | null };
};

export async function getProviderStatus(): Promise<ProviderStatus> {
  const codex = await readCodexTokens();
  return {
    provider: pickProvider(codex !== null), codexModel: CODEX_MODEL,
    compat: { baseUrl: COMPAT_BASE_URL, model: COMPAT_MODEL, apiKeySet: Boolean(process.env.SEEM_BOX_COMPAT_API_KEY?.trim()) },
    codex: { loggedIn: codex !== null, planType: codex?.planType ?? null, accountID: codex?.accountID ?? null, expiresAt: codex?.expiresAt ?? null },
  };
}

function pickProvider(codexLoggedIn: boolean): ProviderID | null {
  const pref = process.env.SEEM_BOX_LLM_PROVIDER?.trim().toLowerCase();
  if (pref === "codex" || pref === "compat") return pref;
  if (codexLoggedIn) return "codex";
  if (process.env.SEEM_BOX_COMPAT_BASE_URL?.trim()) return "compat";
  return null;
}

export async function summarize(input: { title: string; author: string; transcript: string; model?: string }): Promise<StructuredSummary & { provider: ProviderID; model: string }> {
  const provider = pickProvider((await readCodexTokens()) !== null);
  if (!provider) throw new AppError("No LLM provider is ready. Connect ChatGPT in Settings, or configure SEEM_BOX_COMPAT_BASE_URL in .env.local.", 400);
  const model = provider === "codex" ? await resolveCodexModel(input.model) : COMPAT_MODEL;
  const structured = await summarizeTranscript(input, (args) => provider === "codex" ? codexComplete({ ...args, model }) : compatComplete({ ...args, model }));
  return { ...structured, provider, model };
}
