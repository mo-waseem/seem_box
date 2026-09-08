import { handleExtensionSummary } from "@/lib/extension-summary-handler";
import { summarize } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  return handleExtensionSummary(request, process.env.SEEM_BOX_EXTENSION_TOKEN, summarize);
}
