import { pollDeviceLogin } from "@/lib/llm/device-auth";

export async function GET(request: Request) {
  const flowId = new URL(request.url).searchParams.get("flowId");
  if (!flowId) {
    return Response.json({ status: "error", message: "Missing flowId." }, { status: 400 });
  }
  return Response.json(await pollDeviceLogin(flowId));
}
