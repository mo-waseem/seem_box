import { AppError } from "@/lib/errors";
import { pollDeviceLogin } from "@/lib/llm/device-auth";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const flowId = new URL(request.url).searchParams.get("flowId");
    if (!flowId) {
      return Response.json({ status: "error", message: "Missing flowId." }, { status: 400, headers });
    }
    return Response.json(await pollDeviceLogin(flowId), { headers });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return Response.json({ status: "error", message }, { status, headers });
  }
}
