import "server-only";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { AppError } from "../errors";
import { cloudflareAuth, usesCloudflareAuth } from "./auth-cloudflare";
import type { CodexTokens } from "./auth-types";

export type { CodexTokens } from "./auth-types";

export type AuthFile = {
  codex?: CodexTokens;
};

const AUTH_DIR = join(homedir(), ".seem_box");
const AUTH_FILE = join(AUTH_DIR, "auth.json");

export async function readAuth(): Promise<AuthFile> {
  if (usesCloudflareAuth()) {
    const codex = await cloudflareAuth<CodexTokens | null>({ op: "read" });
    return codex ? { codex } : {};
  }
  try {
    const raw = await readFile(AUTH_FILE, "utf8");
    const parsed = JSON.parse(raw) as AuthFile;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid auth file");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new AppError("Could not read local ChatGPT authentication storage.", 503);
  }
}

export async function readCodexTokens(): Promise<CodexTokens | null> {
  const auth = await readAuth();
  return auth.codex ?? null;
}

export async function writeCodexTokens(tokens: CodexTokens): Promise<void> {
  if (usesCloudflareAuth()) return cloudflareAuth({ op: "write", tokens });
  await mkdir(AUTH_DIR, { recursive: true });
  const current = await readAuth();
  const next: AuthFile = { ...current, codex: tokens };
  await writeFile(AUTH_FILE, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  await chmod(AUTH_FILE, 0o600).catch(() => undefined);
}
