import type { Metadata } from "next";
import { connection } from "next/server";
import SummaryTool from "@/components/summary-tool";
import { getProviderStatus } from "@/lib/llm";
import { listCodexModels } from "@/lib/llm/codex";

export const metadata: Metadata = {
  title: "YouTube Summary",
};

export default async function YouTubeSummaryPage() {
  await connection();
  const status = await getProviderStatus();
  let models: string[] = [];
  if (status.provider === "codex" && status.codex.loggedIn) {
    try {
      models = (await listCodexModels()).filter(
        (model) => model.startsWith("gpt-") && !model.includes("reserve"),
      );
    } catch {
      models = [status.codexModel];
    }
  }
  const defaultModel =
    status.provider === "codex"
      ? models.includes(status.codexModel)
        ? status.codexModel
        : (models[0] ?? status.codexModel)
      : status.compat.model;
  return (
    <section className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">YouTube Summary</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Captions are fetched from the video, then summarized by your connected LLM.
        </p>
      </div>
      <SummaryTool models={models} defaultModel={defaultModel} />
    </section>
  );
}
