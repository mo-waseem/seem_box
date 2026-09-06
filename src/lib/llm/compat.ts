import "server-only";
import { AppError } from "@/lib/errors";

export const COMPAT_BASE_URL = (process.env.SEEM_BOX_COMPAT_BASE_URL?.trim() || "http://127.0.0.1:8080").replace(/\/+$/, "");

export const COMPAT_MODEL = process.env.SEEM_BOX_COMPAT_MODEL?.trim() || "gpt-4o-mini";

export async function compatComplete({ system, user, model = COMPAT_MODEL }: { system: string; user: string; model?: string }): Promise<string> {
  const apiKey = process.env.SEEM_BOX_COMPAT_API_KEY?.trim();
  let response: Response;
  try {
    response = await fetch(`${COMPAT_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
  } catch {
    throw new AppError(`Could not reach the sidecar at ${COMPAT_BASE_URL}. Is it running?`, 502);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const snippet = detail.slice(0, 300).replace(/\s+/g, " ").trim();
    throw new AppError(`Sidecar error (HTTP ${response.status})${snippet ? `: ${snippet}` : "."}`, 502);
  }
  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new AppError("The sidecar model returned no content.", 502);
  return content;
}
