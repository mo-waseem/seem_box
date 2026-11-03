"use client";

import { useEffect, useRef, useState } from "react";

type SummaryLanguage = "en" | "ar";

const LANGUAGES: { value: SummaryLanguage; label: string; short: string }[] = [
  { value: "en", label: "English", short: "EN" },
  { value: "ar", label: "العربية", short: "ع" },
];

type SummaryResponse = {
  video: { title: string; author: string; durationSeconds: number | null };
  summary: string;
  takeaways: string[];
  conclusion: string;
  language?: SummaryLanguage;
  meta: { provider: string; model: string; transcriptChars: number; language: string | null };
};

export default function SummaryTool({ models, defaultModel }: { models: string[]; defaultModel: string }) {
  const [url, setUrl] = useState("");
  const [model, setModel] = useState(defaultModel);
  const [language, setLanguage] = useState<SummaryLanguage>("en");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SummaryResponse | null>(null);

  async function requestSummary(targetLanguage: SummaryLanguage) {
    if (loading || !url.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/youtube-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, model, language: targetLanguage }),
      });
      const data = (await response.json()) as SummaryResponse & { error?: string };
      if (!response.ok) {
        throw new Error(data?.error ?? `Request failed with status ${response.status}.`);
      }
      setLanguage(data.language ?? targetLanguage);
      setResult(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await requestSummary(language);
  }

  async function handleLanguageChange(next: SummaryLanguage) {
    if (next === language || loading) return;
    setLanguage(next);
    if (result) await requestSummary(next);
  }

  return (
    <div className="space-y-8">
      <form
        onSubmit={handleSubmit}
        className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]"
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
        <LanguageMenu value={language} onChange={(next) => void handleLanguageChange(next)} disabled={loading} />
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
      {result && <SummaryCard result={result} language={language} onLanguageChange={handleLanguageChange} disabled={loading} />}
    </div>
  );
}

function LanguageMenu({ value, onChange, disabled, compact }: { value: SummaryLanguage; onChange: (next: SummaryLanguage) => void; disabled: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open ]);

  const current = LANGUAGES.find((option) => option.value === value) ?? LANGUAGES[0];
  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Summary language: ${current.label}. Change language.`}
        title="Summary language"
        disabled={disabled}
        onClick={() => setOpen((previous) => !previous)}
        className={`flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-200 transition-colors hover:border-neutral-500 focus:border-neutral-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${compact ? "h-8 px-2.5 text-xs" : "h-11 px-3 text-sm"}`}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        <span className="font-medium">{current.short}</span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Summary language"
          className="absolute end-0 z-10 mt-2 w-36 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 py-1 shadow-xl shadow-black/40"
        >
          {LANGUAGES.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setOpen(false);
                  buttonRef.current?.focus();
                  if (!active) onChange(option.value);
                }}
                className={`flex w-full items-center justify-between px-3 py-2 text-sm transition-colors hover:bg-neutral-800 ${active ? "text-neutral-100" : "text-neutral-400"}`}
              >
                <span dir="auto">{option.label}</span>
                {active && <span aria-hidden="true">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ result, language, onLanguageChange, disabled }: { result: SummaryResponse; language: SummaryLanguage; onLanguageChange: (next: SummaryLanguage) => void; disabled: boolean }) {
  const { video, meta } = result;
  const isArabic = (result.language ?? language) === "ar";
  return (
    <article className="space-y-6 rounded-xl border border-neutral-800 bg-neutral-900/50 p-6">
      <div className="flex justify-end">
        <LanguageMenu value={result.language ?? language} onChange={(next) => void onLanguageChange(next)} disabled={disabled} compact />
      </div>
      <div dir={isArabic ? "rtl" : "ltr"} lang={isArabic ? "ar" : "en"} className="space-y-6">
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
      <Section title={isArabic ? "الملخص" : "Summary"}>
        <p className="text-sm leading-relaxed text-neutral-300">{result.summary}</p>
      </Section>
      {result.takeaways.length > 0 && (
        <Section title={isArabic ? "أهم النقاط" : "Key takeaways"}>
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
        <Section title={isArabic ? "الخلاصة" : "Conclusion"}>
          <p className="text-sm leading-relaxed text-neutral-300">{result.conclusion}</p>
        </Section>
      )}
      </div>
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
