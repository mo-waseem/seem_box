import "server-only";
import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/errors";
import { writeCodexTokens, type CodexTokens } from "./token-store";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const ISSUER = "https://auth.openai.com";
const DEVICE_CALLBACK = `${ISSUER}/deviceauth/callback`;
const USER_AGENT = "seem_box/1.0";

export type DeviceLoginStart = {
  flowId: string;
  userCode: string;
  verificationUrl: string;
  intervalMs: number;
};

export type DeviceLoginPoll =
  | { status: "pending" }
  | { status: "success" }
  | { status: "error"; message: string };

type UserCodeResponse = {
  device_auth_id?: string;
  user_code?: string;
  usercode?: string;
  interval?: string | number;
};

type DevicePollResponse = {
  authorization_code?: string;
  code_verifier?: string;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
};

const pendingFlows = new Map<string, { deviceAuthId: string; userCode: string }>();

async function postJSON(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      originator: "seem_box",
    },
    body: JSON.stringify(body),
  });
}

async function postForm(url: string, body: URLSearchParams): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
      originator: "seem_box",
    },
    body,
  });
}

export async function startDeviceLogin(): Promise<DeviceLoginStart> {
  const response = await postJSON(`${ISSUER}/api/accounts/deviceauth/usercode`, {
    client_id: CLIENT_ID,
  });
  if (!response.ok) {
    throw new AppError(`OpenAI device authorization is unavailable (HTTP ${response.status}).`, 502);
  }
  const data = (await response.json()) as UserCodeResponse;
  const deviceAuthId = data.device_auth_id;
  const userCode = data.user_code ?? data.usercode;
  if (!deviceAuthId || !userCode) {
    throw new AppError("OpenAI returned an unexpected device authorization response.", 502);
  }
  const intervalMs = Math.max(Number(data.interval ?? 5) || 5, 1) * 1000;
  const flowId = randomUUID();
  pendingFlows.set(flowId, { deviceAuthId, userCode });
  return { flowId, userCode, verificationUrl: `${ISSUER}/codex/device`, intervalMs };
}

export async function pollDeviceLogin(flowId: string): Promise<DeviceLoginPoll> {
  const flow = pendingFlows.get(flowId);
  if (!flow) {
    return { status: "error", message: "This login request expired. Start again." };
  }
  let response: Response;
  try {
    response = await postJSON(`${ISSUER}/api/accounts/deviceauth/token`, {
      device_auth_id: flow.deviceAuthId,
      user_code: flow.userCode,
    });
  } catch {
    return { status: "pending" };
  }
  if (response.status === 403 || response.status === 404) {
    return { status: "pending" };
  }
  if (!response.ok) {
    pendingFlows.delete(flowId);
    return { status: "error", message: `Device authorization failed (HTTP ${response.status}).` };
  }
  const data = (await response.json()) as DevicePollResponse;
  pendingFlows.delete(flowId);
  if (!data.authorization_code || !data.code_verifier) {
    return { status: "error", message: "OpenAI returned an unexpected device token response." };
  }
  try {
    await exchangeDeviceCode(data.authorization_code, data.code_verifier);
    return { status: "success" };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Token exchange failed." };
  }
}

async function exchangeDeviceCode(code: string, codeVerifier: string): Promise<CodexTokens> {
  const response = await postForm(
    `${ISSUER}/oauth/token`,
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: DEVICE_CALLBACK,
      client_id: CLIENT_ID,
      code_verifier: codeVerifier,
    }),
  );
  if (!response.ok) {
    throw new AppError(`Token exchange failed (HTTP ${response.status}).`, 502);
  }
  const data = (await response.json()) as TokenResponse;
  if (!data.access_token || !data.refresh_token) {
    throw new AppError("Token exchange response was missing tokens.", 502);
  }
  const claims = parseTokenClaims(data.id_token ?? "");
  const tokens: CodexTokens = {
    access: data.access_token,
    refresh: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    accountID: claims.accountID,
    planType: claims.planType,
  };
  await writeCodexTokens(tokens);
  return tokens;
}

export async function refreshCodexTokens(refreshToken: string): Promise<CodexTokens> {
  const response = await postForm(
    `${ISSUER}/oauth/token`,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  );
  if (!response.ok) {
    throw new AppError(`Session refresh failed (HTTP ${response.status}). Reconnect ChatGPT in Settings.`, 502);
  }
  const data = (await response.json()) as TokenResponse;
  if (!data.access_token || !data.refresh_token) {
    throw new AppError("Session refresh response was missing tokens.", 502);
  }
  const claims = parseTokenClaims(data.id_token ?? "");
  return {
    access: data.access_token,
    refresh: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    accountID: claims.accountID,
    planType: claims.planType,
  };
}

type TokenClaims = {
  chatgpt_account_id?: string;
  organizations?: { id: string }[];
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string;
    chatgpt_plan_type?: string;
  };
};

export function parseTokenClaims(token: string): { accountID: string | null; planType: string | null } {
  const payload = token.split(".")[1];
  if (!payload) return { accountID: null, planType: null };
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as TokenClaims;
    const auth = claims["https://api.openai.com/auth"];
    return {
      accountID:
        claims.chatgpt_account_id ?? auth?.chatgpt_account_id ?? claims.organizations?.[0]?.id ?? null,
      planType: auth?.chatgpt_plan_type ?? null,
    };
  } catch {
    return { accountID: null, planType: null };
  }
}
