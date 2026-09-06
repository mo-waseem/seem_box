"use client";

import { useState } from "react";

type SummaryResponse = {
  video: { title: string; author: string; durationSeconds: number | null };
  summary: string;
  takeaways: string[];
  conclusion: string;
  meta: { provider: string; model: string; transcriptChars: number; language: string | null };
};

export default function SummaryTool({ models, defaultModel }: { models: string[]; defaultModel: string }) {
  const [url, setUrl] = useState("");
  const [model, setModel] = useState(defaultModel);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SummaryResponse | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || !url.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/youtube-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, model }),
      });
      const data = (await response.json()) as SummaryResponse & { error?: string };
      if (!response.ok) {
        throw new Error(data?.error ?? `Request failed with status ${response.status}.`);
      }
      setResult(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <form
        onSubmit={handleSubmit}
        className={
          models.length > 0
            ? "grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem_auto]"
            : "flex flex-col gap-3 sm:flex-row"
        }
      >
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
          type="text"
          autoComplete="off"
          spellCheck={false}
          className="h-11 flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-4 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
        />
        {models.length > 0 && (
          <select
            value={model}
            onChange={(event) => setModel(event.target.value)}
            aria-label="Summary model"
            className="h-11 rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm text-neutral-200 focus:border-neutral-500 focus:outline-none"
          >
            {models.map((availableModel) => (
              <option key={availableModel} value={availableModel}>
                {formatModelName(availableModel)}
              </option>
            ))}
          </select>
        )}
        <button
          type="submit"
          disabled={loading || !url.trim()}
          className="h-11 rounded-lg bg-neutral-100 px-6 text-sm font-medium text-neutral-900 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "Summarizing…" : "Summarize"}
        </button>
      </form>
      {loading && (
        <p className="text-sm text-neutral-500">
          Fetching captions and summarizing — this can take up to a minute.
        </p>
      )}
      {error && (
        <p className="rounded-lg border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}
      {result && <SummaryCard result={result} />}
    </div>
  );
}

function SummaryCard({ result }: { result: SummaryResponse }) {
  const { video, meta } = result;
  return (
    <article className="space-y-6 rounded-xl border border-neutral-800 bg-neutral-900/50 p-6">
      <header className="space-y-1">
        <h2 className="text-lg font-medium leading-snug text-neutral-100">{video.title}</h2>
        <p className="text-xs text-neutral-500">
          {video.author}
          {video.durationSeconds ? ` · ${formatDuration(video.durationSeconds)}` : ""}
          {` · ${meta.transcriptChars.toLocaleString()} caption characters`}
          {meta.language ? ` · ${meta.language}` : ""}
          {` · ${meta.provider} (${meta.model})`}
        </p>
      </header>
      <Section title="Summary">
        <p className="text-sm leading-relaxed text-neutral-300">{result.summary}</p>
      </Section>
      {result.takeaways.length > 0 && (
        <Section title="Key takeaways">
          <ul className="space-y-2">
            {result.takeaways.map((takeaway, index) => (
              <li key={index} className="flex gap-3 text-sm leading-relaxed text-neutral-300">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-neutral-500" />
                <span>{takeaway}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {result.conclusion && (
        <Section title="Conclusion">
          <p className="text-sm leading-relaxed text-neutral-300">{result.conclusion}</p>
        </Section>
      )}
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wider text-neutral-500">{title}</h3>
      {children}
    </section>
  );
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${rest}s`;
  return `${rest}s`;
}

function formatModelName(model: string): string {
  return model
    .split("-")
    .map((part) => (part === "gpt" ? "GPT" : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}
