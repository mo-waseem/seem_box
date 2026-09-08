export type StructuredSummary = { summary: string; takeaways: string[]; conclusion: string };
type Complete = (args: { system: string; user: string }) => Promise<string>;

const SUMMARY_SYSTEM = [
  "You summarize YouTube videos from their transcripts.",
  'Respond with ONLY a JSON object of this exact shape: {"summary": string, "takeaways": string[], "conclusion": string}.',
  "No markdown fences and no text before or after the JSON.",
  '"summary": one concise paragraph (3-6 sentences) describing what the video covers.',
  '"takeaways": 5-8 key points, each a single standalone sentence.',
  '"conclusion": one short paragraph (2-4 sentences) stating the video conclusion and its practical value.',
].join("\n");
const PART_SYSTEM = "You are given one part of a long YouTube video transcript. Summarize that part in 3-5 sentences of plain text. No preamble.";

export async function summarizeTranscript(input: { title: string; author: string; transcript: string }, complete: Complete): Promise<StructuredSummary> {
  let user = `Title: ${input.title}\nChannel: ${input.author}\n\nTranscript:\n${input.transcript}`;
  if (input.transcript.length > 90_000) {
    const chunks: string[] = [];
    let cursor = 0;
    while (cursor < input.transcript.length) {
      let end = Math.min(cursor + 30_000, input.transcript.length);
      if (end < input.transcript.length) {
        const lastStop = input.transcript.lastIndexOf(". ", end);
        if (lastStop > cursor + 15_000) end = lastStop + 1;
      }
      const chunk = input.transcript.slice(cursor, end).trim();
      if (chunk) chunks.push(chunk);
      cursor = end;
    }
    const parts: string[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const text = await complete({ system: PART_SYSTEM, user: `Title: ${input.title}\n\nPart ${index + 1} of ${chunks.length}:\n${chunks[index]}` });
      parts.push(`Part ${index + 1}:\n${text.trim()}`);
    }
    user = `This video transcript is long, so it was summarized in parts. Combine the part summaries into the final JSON summary of the whole video.\n\nTitle: ${input.title}\nChannel: ${input.author}\n\nPart summaries:\n${parts.join("\n\n")}`;
  }
  return parseStructured(await complete({ system: SUMMARY_SYSTEM, user }));
}

export function parseStructured(text: string): StructuredSummary {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1)) as { summary?: unknown; takeaways?: unknown; conclusion?: unknown };
      const takeaways = normalizeTakeaways(parsed.takeaways);
      const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
      const conclusion = typeof parsed.conclusion === "string" ? parsed.conclusion.trim() : "";
      if (summary || takeaways.length > 0 || conclusion) return { summary: summary || cleaned, takeaways, conclusion };
    } catch {
      return { summary: cleaned, takeaways: [], conclusion: "" };
    }
  }
  return { summary: cleaned, takeaways: [], conclusion: "" };
}

function normalizeTakeaways(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
  if (typeof value === "string") return value.split("\n").map((line) => line.replace(/^[-*\u2022\s]*(?:\d+[.)]\s*)?/, "").trim()).filter(Boolean);
  return [];
}
