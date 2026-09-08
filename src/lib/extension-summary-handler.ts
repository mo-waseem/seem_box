import { AppError } from "./errors";

const MAX_BODY_BYTES = 2 * 1024 * 1024;

export async function handleExtensionSummary(
  request: Request,
  token: string | undefined,
  summarize: (input: { videoId: string; title: string; author: string; transcript: string }, signal: AbortSignal) => Promise<unknown>,
): Promise<Response> {
  try {
    if (!token || token.length < 32) {
      throw new AppError("Extension access is not configured.", 503);
    }
    const supplied = /^Bearer ([^\s]+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
    const encoder = new TextEncoder();
    // WebCrypto verifies fixed-size HMAC hashes without a JS string/byte comparison.
    const key = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    const expectedHash = await crypto.subtle.sign("HMAC", key, encoder.encode(token));
    const matches = await crypto.subtle.verify("HMAC", key, expectedHash, encoder.encode(supplied ?? ""));
    if (!supplied || !matches) {
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
      const combined = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
      }
      body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(combined));
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

    const abortController = new AbortController();
    let finished = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let onAbort: () => void;
    const cleanup = () => {
      finished = true;
      clearInterval(heartbeat);
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", onAbort);
    };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        onAbort = () => {
          if (finished) return;
          cleanup();
          controller.close();
          abortController.abort(request.signal.reason);
        };
        request.signal.addEventListener("abort", onAbort, { once: true });
        if (request.signal.aborted) {
          onAbort();
          return;
        }
        const finish = (result: unknown) => {
          if (finished) return;
          const json = JSON.stringify(result);
          cleanup();
          controller.enqueue(encoder.encode(json));
          controller.close();
        };
        // JSON whitespace flushes headers and keeps the extension fetch alive.
        controller.enqueue(encoder.encode("\n"));
        heartbeat = setInterval(() => {
          if (!finished) controller.enqueue(encoder.encode("\n"));
        }, 15_000);
        timeout = setTimeout(() => {
          if (finished) return;
          finish({ error: "Summary timed out." });
          abortController.abort(new DOMException("Summary timed out.", "TimeoutError"));
        }, 300_000);
        void (async () => {
          try {
            finish(await summarize({ videoId, title, author, transcript: transcript.trim() }, abortController.signal));
          } catch (error) {
            finish({ error: error instanceof Error ? error.message : "Unexpected error." });
          }
        })();
      },
      cancel(reason) {
        if (finished) return;
        cleanup();
        abortController.abort(reason);
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
    return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
