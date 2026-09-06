import { AppError } from "@/lib/errors";
import { startDeviceLogin } from "@/lib/llm/device-auth";

export async function POST() {
  try {
    const flow = await startDeviceLogin();
    return Response.json(flow, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
