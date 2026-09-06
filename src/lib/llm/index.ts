import "server-only";
import { AppError } from "@/lib/errors";
import { COMPAT_BASE_URL, COMPAT_MODEL, compatComplete } from "./compat";
import { CODEX_MODEL, codexComplete, resolveCodexModel } from "./codex";
import { readCodexTokens } from "./token-store";

export type ProviderID = "codex" | "compat";

export type StructuredSummary = {
  summary: string;
  takeaways: string[];
  conclusion: string;
};

export type ProviderStatus = {
  provider: ProviderID | null;
  codexModel: string;
  compat: { baseUrl: string; model: string; apiKeySet: boolean };
  codex: { loggedIn: boolean; planType: string | null; accountID: string | null; expiresAt: number | null };
};

const DIRECT_LIMIT = 90_000;
const CHUNK_SIZE = 30_000;

const SUMMARY_SYSTEM = [
  "You summarize YouTube videos from their transcripts.",
  'Respond with ONLY a JSON object of this exact shape: {"summary": string, "takeaways": string[], "conclusion": string}.',
  "No markdown fences and no text before or after the JSON.",
  '"summary": one concise paragraph (3-6 sentences) describing what the video covers.',
  '"takeaways": 5-8 key points, each a single standalone sentence.',
  '"conclusion": one short paragraph (2-4 sentences) stating the video conclusion and its practical value.',
].join("\n");

const PART_SYSTEM = "You are given one part of a long YouTube video transcript. Summarize that part in 3-5 sentences of plain text. No preamble.";

export async function getProviderStatus(): Promise<ProviderStatus> {
  const codex = await readCodexTokens();
  return {
    provider: pickProvider(codex !== null),
    codexModel: CODEX_MODEL,
    compat: {
      baseUrl: COMPAT_BASE_URL,
      model: COMPAT_MODEL,
      apiKeySet: Boolean(process.env.SEEM_BOX_COMPAT_API_KEY?.trim()),
    },
    codex: {
      loggedIn: codex !== null,
      planType: codex?.planType ?? null,
      accountID: codex?.accountID ?? null,
      expiresAt: codex?.expiresAt ?? null,
    },
  };
}

function pickProvider(codexLoggedIn: boolean): ProviderID | null {
  const pref = process.env.SEEM_BOX_LLM_PROVIDER?.trim().toLowerCase();
  if (pref === "codex" || pref === "compat") return pref;
  if (codexLoggedIn) return "codex";
  if (process.env.SEEM_BOX_COMPAT_BASE_URL?.trim()) return "compat";
  return null;
}

async function resolveProvider(): Promise<ProviderID> {
  const provider = pickProvider((await readCodexTokens()) !== null);
  if (!provider) {
    throw new AppError(
      "No LLM provider is ready. Connect ChatGPT in Settings, or configure SEEM_BOX_COMPAT_BASE_URL in .env.local.",
      400,
    );
  }
  return provider;
}

async function chat(provider: ProviderID, model: string, args: { system: string; user: string }): Promise<string> {
  return provider === "codex" ? codexComplete({ ...args, model }) : compatComplete({ ...args, model });
}

export async function summarize(input: {
  title: string;
  author: string;
  transcript: string;
  model?: string;
}): Promise<StructuredSummary & { provider: ProviderID; model: string }> {
  const provider = await resolveProvider();
  const model = provider === "codex" ? await resolveCodexModel(input.model) : COMPAT_MODEL;
  const structured =
    input.transcript.length <= DIRECT_LIMIT
      ? await structuredSummary(provider, model, {
          system: SUMMARY_SYSTEM,
          user: `Title: ${input.title}\nChannel: ${input.author}\n\nTranscript:\n${input.transcript}`,
        })
      : await mapReduce(provider, model, input);
  return { ...structured, provider, model };
}

async function mapReduce(
  provider: ProviderID,
  model: string,
  input: { title: string; author: string; transcript: string },
): Promise<StructuredSummary> {
  const chunks = splitIntoChunks(input.transcript);
  const parts: string[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const text = await chat(provider, model, {
      system: PART_SYSTEM,
      user: `Title: ${input.title}\n\nPart ${index + 1} of ${chunks.length}:\n${chunks[index]}`,
    });
    parts.push(`Part ${index + 1}:\n${text.trim()}`);
  }
  return structuredSummary(provider, model, {
    system: SUMMARY_SYSTEM,
    user: `This video transcript is long, so it was summarized in parts. Combine the part summaries into the final JSON summary of the whole video.\n\nTitle: ${input.title}\nChannel: ${input.author}\n\nPart summaries:\n${parts.join("\n\n")}`,
  });
}

function splitIntoChunks(text: string): string[] {
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let end = Math.min(cursor + CHUNK_SIZE, text.length);
    if (end < text.length) {
      const lastStop = text.lastIndexOf(". ", end);
      if (lastStop > cursor + CHUNK_SIZE / 2) end = lastStop + 1;
    }
    const chunk = text.slice(cursor, end).trim();
    if (chunk) chunks.push(chunk);
    cursor = end;
  }
  return chunks;
}

async function structuredSummary(
  provider: ProviderID,
  model: string,
  args: { system: string; user: string },
): Promise<StructuredSummary> {
  const text = await chat(provider, model, args);
  return parseStructured(text);
}

export function parseStructured(text: string): StructuredSummary {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1)) as {
        summary?: unknown;
        takeaways?: unknown;
        conclusion?: unknown;
      };
      const takeaways = normalizeTakeaways(parsed.takeaways);
      const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
      const conclusion = typeof parsed.conclusion === "string" ? parsed.conclusion.trim() : "";
      if (summary || takeaways.length > 0 || conclusion) {
        return { summary: summary || cleaned, takeaways, conclusion };
      }
    } catch {
      return { summary: cleaned, takeaways: [], conclusion: "" };
    }
  }
  return { summary: cleaned, takeaways: [], conclusion: "" };
}

function normalizeTakeaways(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split("\n")
      .map((line) => line.replace(/^[-*•\s]*(?:\d+[.)]\s*)?/, "").trim())
      .filter(Boolean);
  }
  return [];
}
