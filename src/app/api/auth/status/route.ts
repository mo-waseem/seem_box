import { AppError } from "@/lib/errors";
import { getProviderStatus } from "@/lib/llm";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    return Response.json(await getProviderStatus(), { headers });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return Response.json({ error: message }, { status, headers });
  }
}
