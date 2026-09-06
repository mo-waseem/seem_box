import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { AppError } from "../errors";
import type { AuthBindings, AuthOperation } from "./auth-types";

export function usesCloudflareAuth(): boolean {
  return process.env.SEEM_BOX_AUTH_STORAGE === "cloudflare";
}

export async function cloudflareAuth<T>(operation: AuthOperation): Promise<T> {
  let env: AuthBindings;
  try {
    env = (await getCloudflareContext({ async: true })).env as AuthBindings;
  } catch {
    throw new AppError("Cloudflare authentication requires the SEEM_BOX_AUTH Durable Object binding and Cloudflare context.", 503);
  }
  const namespace = env.SEEM_BOX_AUTH;
  if (!namespace || typeof namespace.idFromName !== "function" || typeof namespace.get !== "function") {
    throw new AppError("Cloudflare authentication requires the SEEM_BOX_AUTH Durable Object binding.", 503);
  }
  try {
    const response = await namespace.get(namespace.idFromName("owner")).fetch(new Request("https://auth.internal/", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(operation),
    }));
    if (!response.ok) {
      // The object returns only sanitized errors, but do not trust transport response bodies.
      throw new AppError(response.status === 502 ? "OpenAI authentication failed. Try again or reconnect ChatGPT." : "Cloudflare authentication storage is unavailable. Try again.", response.status === 502 ? 502 : 503);
    }
    return await response.json() as T;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Cloudflare authentication storage is unavailable. Try again.", 503);
  }
}
