import { AppError } from "../errors";
import type { CodexTokens, DeviceFlow, DeviceLoginPoll, DeviceLoginStart } from "./auth-types";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const ISSUER = "https://auth.openai.com";
export const FLOW_TTL_MS = 15 * 60_000;
export const expiredFlow: DeviceLoginPoll = { status: "error", message: "This login request expired. Start again." };

async function post(path: string, body: URLSearchParams | Record<string, string>) {
  try {
    const response = await fetch(`${ISSUER}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": body instanceof URLSearchParams ? "application/x-www-form-urlencoded" : "application/json",
        "User-Agent": "seem_box/1.0",
        originator: "seem_box",
      },
      body: body instanceof URLSearchParams ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    // Consume the body under the same timeout; never expose upstream error bodies.
    const data: unknown = response.ok ? await response.json() : null;
    if (!response.ok) await response.body?.cancel();
    return { status: response.status, ok: response.ok, data };
  } catch {
    throw new AppError("OpenAI authorization request failed or timed out. Try again.", 502);
  }
}

export async function createDeviceFlow(): Promise<{ start: DeviceLoginStart; flow: DeviceFlow }> {
  const expiresAt = Date.now() + FLOW_TTL_MS;
  const response = await post("/api/accounts/deviceauth/usercode", { client_id: CLIENT_ID });
  if (!response.ok) throw new AppError(`OpenAI device authorization is unavailable (HTTP ${response.status}).`, 502);
  const data = response.data as { device_auth_id?: string; user_code?: string; usercode?: string; interval?: unknown } | null;
  const userCode = data?.user_code ?? data?.usercode;
  if (typeof data?.device_auth_id !== "string" || !data.device_auth_id || typeof userCode !== "string" || !userCode) {
    throw new AppError("OpenAI returned an unexpected device authorization response.", 502);
  }
  const interval = Number(data.interval ?? 5);
  const intervalMs = Math.min(60, Math.max(1, Number.isFinite(interval) ? interval : 5)) * 1000;
  return {
    start: { flowId: crypto.randomUUID(), userCode, verificationUrl: `${ISSUER}/codex/device`, intervalMs },
    flow: { deviceAuthId: data.device_auth_id, userCode, expiresAt, intervalMs, nextPollAt: 0, result: { status: "pending" } },
  };
}

export async function advanceDeviceFlow(flow: DeviceFlow): Promise<{ result: DeviceLoginPoll; tokens?: CodexTokens }> {
  if (Date.now() >= flow.expiresAt) return { result: expiredFlow };
  if (flow.result.status !== "pending") return { result: flow.result };
  let response;
  try {
    response = await post("/api/accounts/deviceauth/token", { device_auth_id: flow.deviceAuthId, user_code: flow.userCode });
  } catch {
    return { result: { status: "pending" } };
  }
  if (response.status === 403 || response.status === 404) return { result: { status: "pending" } };
  if (!response.ok) return { result: { status: "error", message: `Device authorization failed (HTTP ${response.status}).` } };
  const data = response.data as { authorization_code?: string; code_verifier?: string } | null;
  if (typeof data?.authorization_code !== "string" || typeof data.code_verifier !== "string" || !data.authorization_code || !data.code_verifier) {
    return { result: { status: "error", message: "OpenAI returned an unexpected device token response." } };
  }
  try {
    const tokens = await requestTokens(new URLSearchParams({
      grant_type: "authorization_code", code: data.authorization_code, code_verifier: data.code_verifier,
      redirect_uri: `${ISSUER}/deviceauth/callback`, client_id: CLIENT_ID,
    }));
    if (Date.now() >= flow.expiresAt) return { result: expiredFlow };
    return { result: { status: "success" }, tokens };
  } catch {
    return { result: { status: "error", message: "Token exchange failed. Start again." } };
  }
}

async function requestTokens(body: URLSearchParams): Promise<CodexTokens> {
  const response = await post("/oauth/token", body);
  if (!response.ok) throw new AppError(`OpenAI token request failed (HTTP ${response.status}). Reconnect ChatGPT in Settings.`, 502);
  const data = response.data as { access_token?: string; refresh_token?: string; id_token?: string; expires_in?: number } | null;
  if (typeof data?.access_token !== "string" || !data.access_token || typeof data.refresh_token !== "string" || !data.refresh_token) {
    throw new AppError("OpenAI token response was missing tokens.", 502);
  }
  return {
    access: data.access_token, refresh: data.refresh_token,
    expiresAt: Date.now() + (typeof data.expires_in === "number" && Number.isFinite(data.expires_in) ? Math.max(0, data.expires_in) : 3600) * 1000,
    ...parseTokenClaims(data.id_token ?? ""),
  };
}

export async function refreshCodexTokens(refreshToken: string): Promise<CodexTokens> {
  return requestTokens(new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: CLIENT_ID }));
}

export function parseTokenClaims(token: string): { accountID: string | null; planType: string | null } {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))));
    const auth = claims["https://api.openai.com/auth"];
    const accountID = claims.chatgpt_account_id ?? auth?.chatgpt_account_id ?? claims.organizations?.[0]?.id;
    const planType = auth?.chatgpt_plan_type;
    return { accountID: typeof accountID === "string" ? accountID : null, planType: typeof planType === "string" ? planType : null };
  } catch {
    return { accountID: null, planType: null };
  }
}
