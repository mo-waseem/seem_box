import { AppError } from "@/lib/errors";
import { listCodexModels } from "@/lib/llm/codex";

export async function GET() {
  try {
    return Response.json({ models: await listCodexModels() });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return Response.json({ error: message }, { status });
  }
}
