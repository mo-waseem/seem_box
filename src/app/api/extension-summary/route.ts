import { timingSafeEqual } from "node:crypto";
import { AppError } from "@/lib/errors";
import { summarize } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BODY_BYTES = 2 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const token = process.env.SEEM_BOX_EXTENSION_TOKEN;
    if (!token || token.length < 32) {
      throw new AppError("Extension access is not configured.", 503);
    }
    const supplied = /^Bearer ([^\s]+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
    const expectedBytes = Buffer.from(token);
    const suppliedBytes = Buffer.from(supplied ?? "");
    if (!supplied || suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
      throw new AppError("Invalid extension token.", 401);
    }

    const contentLength = request.headers.get("content-length");
    if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_BODY_BYTES) {
      throw new AppError("Request body is too large.", 413);
    }

    let body: unknown;
    try {
      const reader = request.body?.getReader();
      if (!reader) throw new AppError("Invalid JSON body.", 400);
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_BODY_BYTES) {
            void reader.cancel().catch(() => {});
            throw new AppError("Request body is too large.", 413);
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes)));
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("Invalid JSON body.", 400);
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new AppError("Invalid request body.", 400);
    }
    const { videoId, title, author, transcript } = body as Record<string, unknown>;
    if (typeof videoId !== "string" || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      throw new AppError("Invalid videoId.", 400);
    }
    if (typeof title !== "string" || title.length > 500) {
      throw new AppError("Invalid title (maximum 500 characters).", 400);
    }
    if (typeof author !== "string" || author.length > 300) {
      throw new AppError("Invalid author (maximum 300 characters).", 400);
    }
    if (typeof transcript !== "string" || !transcript.trim() || transcript.length > 500_000) {
      throw new AppError("Invalid transcript (required, maximum 500000 characters).", 400);
    }

    const encoder = new TextEncoder();
    let cancelled = false;
    let heartbeat: ReturnType<typeof setInterval>;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // JSON whitespace flushes headers and keeps the extension fetch alive.
        controller.enqueue(encoder.encode("\n"));
        heartbeat = setInterval(() => {
          if (!cancelled) controller.enqueue(encoder.encode("\n"));
        }, 15_000);
        void (async () => {
          let result;
          try {
            result = await summarize({ title, author, transcript: transcript.trim() });
          } catch (error) {
            result = { error: error instanceof Error ? error.message : "Unexpected error." };
          } finally {
            clearInterval(heartbeat);
          }
          if (!cancelled) {
            controller.enqueue(encoder.encode(JSON.stringify(result)));
            controller.close();
          }
        })();
      },
      cancel() {
        cancelled = true;
        clearInterval(heartbeat);
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return Response.json({ error: message }, { status });
  }
}
