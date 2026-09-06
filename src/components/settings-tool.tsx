"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ProviderStatus = {
  provider: "codex" | "compat" | null;
  codexModel: string;
  compat: { baseUrl: string; model: string; apiKeySet: boolean };
  codex: { loggedIn: boolean; planType: string | null; accountID: string | null; expiresAt: number | null };
};

type Flow = { flowId: string; userCode: string; verificationUrl: string; intervalMs: number; expiresAt: number };

function errorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object") {
    if ("message" in data && typeof data.message === "string" && data.message) return data.message;
    if ("error" in data && typeof data.error === "string" && data.error) return data.error;
  }
  return fallback;
}

export default function SettingsTool({ initialStatus }: { initialStatus: ProviderStatus }) {
  const [status, setStatus] = useState<ProviderStatus>(initialStatus);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  const generationRef = useRef(0);

  useEffect(() => () => { generationRef.current += 1; }, []);

  const loadStatus = useCallback(async () => {
    const response = await fetch("/api/auth/status", {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await response.json()) as ProviderStatus;
    if (!response.ok) throw new Error(errorMessage(data, "Could not verify login status."));
    if (
      !data || !["codex", "compat", null].includes(data.provider) ||
      typeof data.codexModel !== "string" || typeof data.codex?.loggedIn !== "boolean" ||
      typeof data.compat?.baseUrl !== "string" || typeof data.compat?.model !== "string" ||
      typeof data.compat?.apiKeySet !== "boolean" ||
      !(data.codex.planType === null || typeof data.codex.planType === "string") ||
      !(data.codex.accountID === null || typeof data.codex.accountID === "string") ||
      !(data.codex.expiresAt === null || (typeof data.codex.expiresAt === "number" && Number.isFinite(data.codex.expiresAt)))
    ) {
      throw new Error("Invalid login status response.");
    }
    return data;
  }, []);

  useEffect(() => {
    if (!flow) return;
    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    const generation = generationRef.current;
    const isCurrent = () => !cancelled && generation === generationRef.current;
    const finish = (text: string) => {
      cancelled = true;
      clearTimeout(timer);
      setFlow(null);
      setMessage(text);
    };
    const expire = () => finish("This login request expired. Start again.");
    const deadlineTimer = setTimeout(() => {
      if (isCurrent()) expire();
    }, Math.max(0, flow.expiresAt - Date.now()));
    const schedule = () => {
      timer = setTimeout(() => { void poll(); }, Math.min(flow.intervalMs, Math.max(0, flow.expiresAt - Date.now())));
    };
    const poll = async () => {
      if (!isCurrent()) return;
      if (Date.now() >= flow.expiresAt) return expire();
      try {
        const response = await fetch(`/api/auth/device/poll?flowId=${encodeURIComponent(flow.flowId)}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(Math.min(45_000, Math.max(1, flow.expiresAt - Date.now()))),
        });
        const data = (await response.json()) as { status?: string } | null;
        if (!isCurrent()) return;
        if (Date.now() >= flow.expiresAt) return expire();
        if (!response.ok) {
          finish(errorMessage(data, `Device login failed (HTTP ${response.status}). Start again.`));
          return;
        }
        if (!data || !["pending", "success", "error"].includes(data.status ?? "")) {
          throw new Error("Invalid device login response.");
        }
        failures = 0;
        if (data.status === "pending") {
          schedule();
          return;
        }
        if (data.status === "success") {
          finish("Login completed. Verifying connection...");
          try {
            const updated = await loadStatus();
            if (generation !== generationRef.current) return;
            setStatus(updated);
            setMessage(updated.codex.loggedIn
              ? "ChatGPT connected."
              : "Login completed, but connection verification failed. Reload Settings to check your connection.");
          } catch {
            if (generation !== generationRef.current) return;
            setMessage("Login completed, but connection verification failed. Reload Settings to check your connection.");
          }
          return;
        }
        finish(errorMessage(data, "Device login failed. Start again."));
      } catch {
        if (!isCurrent()) return;
        if (Date.now() >= flow.expiresAt) return expire();
        failures += 1;
        if (failures >= 3) {
          finish("Could not check device login after 3 attempts. Check your connection and start again.");
          return;
        }
        schedule();
      }
    };
    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(deadlineTimer);
    };
  }, [flow, loadStatus]);

  async function startLogin() {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    const generation = ++generationRef.current;
    const expiresAt = Date.now() + 15 * 60_000;
    setFlow(null);
    setMessage(null);
    try {
      const response = await fetch("/api/auth/device/start", {
        method: "POST",
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      const data = (await response.json()) as Partial<Flow> | null;
      if (generation !== generationRef.current) return;
      if (!response.ok) {
        throw new Error(errorMessage(data, "Could not start device login."));
      }
      if (
        !data || typeof data.flowId !== "string" || !data.flowId ||
        typeof data.userCode !== "string" || !data.userCode ||
        typeof data.verificationUrl !== "string" || !URL.canParse(data.verificationUrl) ||
        new URL(data.verificationUrl).protocol !== "https:" ||
        typeof data.intervalMs !== "number" || !Number.isFinite(data.intervalMs) || data.intervalMs <= 0 ||
        (data.expiresAt !== undefined && (typeof data.expiresAt !== "number" || !Number.isFinite(data.expiresAt)))
      ) throw new Error("Invalid device login response. Start again.");
      const deadline = Math.min(expiresAt, data.expiresAt ?? expiresAt);
      if (deadline <= Date.now()) throw new Error("This login request expired. Start again.");
      setFlow({
        flowId: data.flowId, userCode: data.userCode, verificationUrl: data.verificationUrl,
        intervalMs: Math.max(1_000, data.intervalMs), expiresAt: deadline,
      });
    } catch (cause) {
      if (generation !== generationRef.current) return;
      setMessage(cause instanceof Error ? cause.message : "Could not start device login.");
    } finally {
      if (generation === generationRef.current) {
        startingRef.current = false;
        setStarting(false);
      }
    }
  }

  return (
    <div className="space-y-6">
      {message && (
        <p className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-4 py-3 text-sm text-neutral-300">
          {message}
        </p>
      )}
      <CodexCard status={status} flow={flow} starting={starting} onStart={startLogin} />
      <CompatCard status={status} />
      <ActiveCard status={status} />
    </div>
  );
}

function CodexCard({
  status,
  flow,
  starting,
  onStart,
}: {
  status: ProviderStatus | null;
  flow: Flow | null;
  starting: boolean;
  onStart: () => void;
}) {
  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium text-neutral-100">ChatGPT (Plus / Pro)</h2>
          <p className="mt-1 text-sm text-neutral-400">
            Official device-code login. Uses your ChatGPT subscription.
          </p>
        </div>
        <span
          className={
            status?.codex.loggedIn
              ? "shrink-0 text-[10px] uppercase tracking-wider text-emerald-400"
              : "shrink-0 text-[10px] uppercase tracking-wider text-neutral-500"
          }
        >
          {status?.codex.loggedIn ? "connected" : "not connected"}
        </span>
      </div>
      {status?.codex.loggedIn && (
        <p className="mt-3 text-xs text-neutral-500">
          {status.codex.planType ? `Plan: ${status.codex.planType}. ` : ""}
          {status.codex.expiresAt
            ? `Access token expires ${formatExpiry(status.codex.expiresAt)} and refreshes automatically.`
            : ""}
        </p>
      )}
      {flow ? (
        <div className="mt-5 rounded-lg border border-neutral-800 bg-neutral-950 p-4">
          <p className="text-sm text-neutral-300">
            Open{" "}
            <a
              href={flow.verificationUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sky-400 underline underline-offset-2"
            >
              {flow.verificationUrl}
            </a>{" "}
            and enter:
          </p>
          <p className="mt-3 font-mono text-2xl tracking-[0.3em] text-neutral-100">{flow.userCode}</p>
          <p className="mt-3 text-xs text-neutral-500">Waiting for authorization…</p>
        </div>
      ) : (
        <button
          onClick={onStart}
          disabled={starting}
          className="mt-5 h-10 rounded-lg border border-neutral-700 px-5 text-sm text-neutral-200 transition-colors hover:border-neutral-500 hover:bg-neutral-900 disabled:cursor-wait disabled:opacity-50"
        >
          {starting ? "Starting..." : status?.codex.loggedIn ? "Reconnect" : "Connect via device code"}
        </button>
      )}
    </section>
  );
}

function formatExpiry(expiresAt: number): string {
  return new Date(expiresAt).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

function CompatCard({ status }: { status: ProviderStatus | null }) {
  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium text-neutral-100">OpenAI-compatible sidecar</h2>
          <p className="mt-1 text-sm text-neutral-400">
            Free ChatGPT web sessions via a local sidecar such as ChatGPT-to-API or g4f.
          </p>
        </div>
        <span className="shrink-0 text-[10px] uppercase tracking-wider text-neutral-500">
          configure in .env.local
        </span>
      </div>
      <dl className="mt-4 space-y-1 text-xs text-neutral-500">
        <div className="flex gap-2">
          <dt className="w-24 shrink-0">Base URL</dt>
          <dd className="font-mono text-neutral-400">{status?.compat.baseUrl}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-24 shrink-0">Model</dt>
          <dd className="font-mono text-neutral-400">{status?.compat.model}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-24 shrink-0">API key</dt>
          <dd className="text-neutral-400">{status?.compat.apiKeySet ? "set" : "not set"}</dd>
        </div>
      </dl>
    </section>
  );
}

function ActiveCard({ status }: { status: ProviderStatus | null }) {
  const label =
    status?.provider === "codex"
      ? `ChatGPT subscription · ${status.codexModel}`
      : status?.provider === "compat"
        ? `Sidecar · ${status.compat.model}`
        : "none";
  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6">
      <h2 className="font-medium text-neutral-100">Active provider</h2>
      <p className="mt-2 text-sm text-neutral-400">{label}</p>
      <p className="mt-1 text-xs text-neutral-600">
        Set SEEM_BOX_LLM_PROVIDER=codex or compat in .env.local to pin one. Otherwise ChatGPT is
        used when connected, with the sidecar as fallback.
      </p>
    </section>
  );
}
