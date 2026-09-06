import { AppError } from "@/lib/errors";
import { summarize } from "@/lib/llm";
import { getTranscript } from "@/lib/transcript";

export const maxDuration = 300;

export async function POST(request: Request) {
  let url: unknown;
  let model: unknown;
  try {
    const body = (await request.json()) as { url?: unknown; model?: unknown };
    url = body?.url;
    model = body?.model;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (typeof url !== "string" || !url.trim()) {
    return Response.json({ error: "A YouTube URL is required." }, { status: 400 });
  }
  if (model !== undefined && (typeof model !== "string" || !/^[a-zA-Z0-9._:-]{1,120}$/.test(model))) {
    return Response.json({ error: "Invalid model." }, { status: 400 });
  }
  try {
    const transcript = await getTranscript(url);
    const result = await summarize({
      title: transcript.title,
      author: transcript.author,
      transcript: transcript.text,
      model: typeof model === "string" ? model : undefined,
    });
    return Response.json({
      video: {
        title: transcript.title,
        author: transcript.author,
        durationSeconds: transcript.durationSeconds,
      },
      summary: result.summary,
      takeaways: result.takeaways,
      conclusion: result.conclusion,
      meta: {
        provider: result.provider,
        model: result.model,
        transcriptChars: transcript.text.length,
        language: transcript.language,
      },
    });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return Response.json({ error: message }, { status });
  }
}
