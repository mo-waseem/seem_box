import { getProviderStatus } from "@/lib/llm";

export async function GET() {
  return Response.json(await getProviderStatus());
}
