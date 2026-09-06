import "server-only";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type CodexTokens = {
  access: string;
  refresh: string;
  expiresAt: number;
  accountID: string | null;
  planType: string | null;
};

export type AuthFile = {
  codex?: CodexTokens;
};

const AUTH_DIR = join(homedir(), ".seem_box");
const AUTH_FILE = join(AUTH_DIR, "auth.json");

export async function readAuth(): Promise<AuthFile> {
  try {
    const raw = await readFile(AUTH_FILE, "utf8");
    const parsed = JSON.parse(raw) as AuthFile;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function readCodexTokens(): Promise<CodexTokens | null> {
  const auth = await readAuth();
  return auth.codex ?? null;
}

export async function writeCodexTokens(tokens: CodexTokens): Promise<void> {
  await mkdir(AUTH_DIR, { recursive: true });
  const current = await readAuth();
  const next: AuthFile = { ...current, codex: tokens };
  await writeFile(AUTH_FILE, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  await chmod(AUTH_FILE, 0o600).catch(() => undefined);
}
