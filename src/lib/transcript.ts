import { Innertube } from "youtubei.js";
import { AppError } from "./errors";
import { normalizeLanguage } from "./llm/summary-core";

export type Transcript = {
  videoId: string;
  title: string;
  author: string;
  durationSeconds: number | null;
  language: string | null;
  text: string;
};

type BasicInfo = { title?: string; author?: string; duration?: number };

type TranscriptSegment = {
  snippet?: { text?: string };
};

type TranscriptInfoShape = {
  transcript?: {
    content?: { body?: { initial_segments?: TranscriptSegment[] } };
  };
  selectedLanguage?: string;
};

type MediaInfo = Awaited<ReturnType<Innertube["getInfo"]>>;

export function extractVideoId(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value.startsWith("http") ? value : `https://${value}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
  }
  if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
    const v = url.searchParams.get("v");
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
    const match = url.pathname.match(/\/(?:shorts|embed|live|v)\/([a-zA-Z0-9_-]{11})/);
    if (match) return match[1];
  }
  return null;
}

export async function getTranscript(input: string, language: unknown = "en"): Promise<Transcript> {
  const videoId = extractVideoId(input);
  if (!videoId) throw new AppError("That does not look like a YouTube video URL.", 400);
  const captionLanguage = normalizeLanguage(language);
  // Captions do not need playback URL deciphering. Skip downloading and parsing
  // YouTube's player JavaScript, which is expensive on resource-limited Workers.
  const yt = await Innertube.create({ retrieve_player: false });
  let title = videoId;
  let author = "Unknown channel";
  let durationSeconds: number | null = null;
  let info: MediaInfo | null = null;
  try {
    info = await yt.getInfo(videoId);
    const basic = info.basic_info as BasicInfo;
    title = basic.title ?? title;
    author = basic.author ?? author;
    durationSeconds = typeof basic.duration === "number" && basic.duration > 0 ? basic.duration : null;
  } catch {
    const metadata = await fallbackMetadata(videoId);
    title = metadata?.title ?? title;
    author = metadata?.author ?? author;
  }
  let text = "";
  let transcriptLanguage: string | null = null;
  if (captionLanguage !== "en") {
    // The primary innertube transcript has no language selection, so try the
    // requested language first and fall through to the default pipeline below.
    const preferred = await fallbackTranscript(videoId, captionLanguage);
    if (preferred) return { videoId, title, author, durationSeconds, language: captionLanguage, text: preferred };
  }
  if (info) {
    try {
      const primary = await innertubeTranscript(info);
      text = primary.text;
      transcriptLanguage = primary.language;
    } catch {
      text = "";
    }
  }
  if (!text) text = await fallbackTranscript(videoId);
  if (!text) throw new AppError("No subtitles or captions are available for this video.", 404);
  return { videoId, title, author, durationSeconds, language: transcriptLanguage, text };
}

async function fallbackMetadata(videoId: string): Promise<{ title: string; author: string } | null> {
  try {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = (await response.json()) as { title?: unknown; author_name?: unknown };
    if (typeof data.title !== "string" || typeof data.author_name !== "string") return null;
    return { title: data.title, author: data.author_name };
  } catch {
    return null;
  }
}

async function innertubeTranscript(info: MediaInfo): Promise<{ text: string; language: string | null }> {
  const transcriptInfo = (await info.getTranscript()) as unknown as TranscriptInfoShape;
  const segments = transcriptInfo?.transcript?.content?.body?.initial_segments ?? [];
  const text = segments
    .map((segment) => segment.snippet?.text ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return { text, language: transcriptInfo?.selectedLanguage ?? null };
}

async function fallbackTranscript(videoId: string, lang?: string): Promise<string> {
  try {
    const mod = (await import("youtube-transcript")) as unknown as {
      YoutubeTranscript?: { fetchTranscript: (id: string, config?: { lang?: string }) => Promise<{ text: string }[]> };
    };
    const api = mod.YoutubeTranscript;
    if (!api) return "";
    const items = await api.fetchTranscript(videoId, lang ? { lang } : undefined);
    return items
      .map((item) => decodeEntities(item.text))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "";
  }
}

function fromCodePoint(value: string, radix: number): string {
  const num = parseInt(value, radix);
  if (!Number.isFinite(num) || num < 0 || num > 0x10ffff) return "";
  try {
    return String.fromCodePoint(num);
  } catch {
    return "";
  }
}

export function decodeEntities(input: string): string {
  let text = input
    .replace(/&amp;#(\d+);/g, (_, code: string) => fromCodePoint(code, 10))
    .replace(/&amp;#x([0-9a-fA-F]+);/g, (_, code: string) => fromCodePoint(code, 16))
    .replace(/&#(\d+);/g, (_, code: string) => fromCodePoint(code, 10))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => fromCodePoint(code, 16));
  text = text
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&nbsp;", " ");
  return text.replaceAll("&amp;", "&");
}
