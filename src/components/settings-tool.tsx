"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ProviderStatus = {
  provider: "codex" | "compat" | null;
  codexModel: string;
  compat: { baseUrl: string; model: string; apiKeySet: boolean };
  codex: { loggedIn: boolean; planType: string | null; accountID: string | null; expiresAt: number | null };
};

type Flow = { flowId: string; userCode: string; verificationUrl: string; intervalMs: number };

export default function SettingsTool({ initialStatus }: { initialStatus: ProviderStatus }) {
  const [status, setStatus] = useState<ProviderStatus>(initialStatus);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/status");
      if (response.ok) {
        setStatus((await response.json()) as ProviderStatus);
      }
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    if (!flow) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/auth/device/poll?flowId=${encodeURIComponent(flow.flowId)}`);
        const data = (await response.json()) as {
          status: "pending" | "success" | "error";
          message?: string;
        };
        if (cancelled) return;
        if (data.status === "pending") {
          timerRef.current = setTimeout(() => {
            void poll();
          }, flow.intervalMs);
          return;
        }
        if (data.status === "success") {
          setFlow(null);
          setMessage("ChatGPT connected.");
          await loadStatus();
          return;
        }
        setMessage(data.message ?? "Device login failed.");
        setFlow(null);
      } catch {
        if (cancelled) return;
        timerRef.current = setTimeout(() => {
          void poll();
        }, flow.intervalMs);
      }
    };
    timerRef.current = setTimeout(() => {
      void poll();
    }, flow.intervalMs);
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [flow, loadStatus]);

  async function startLogin() {
    setMessage(null);
    try {
      const response = await fetch("/api/auth/device/start", { method: "POST" });
      const data = (await response.json()) as Flow & { error?: string };
      if (!response.ok) {
        throw new Error(data?.error ?? "Could not start device login.");
      }
      setFlow(data);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not start device login.");
    }
  }

  return (
    <div className="space-y-6">
      {message && (
        <p className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-4 py-3 text-sm text-neutral-300">
          {message}
        </p>
      )}
      <CodexCard status={status} flow={flow} onStart={startLogin} />
      <CompatCard status={status} />
      <ActiveCard status={status} />
    </div>
  );
}

function CodexCard({
  status,
  flow,
  onStart,
}: {
  status: ProviderStatus | null;
  flow: Flow | null;
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
          className="mt-5 h-10 rounded-lg border border-neutral-700 px-5 text-sm text-neutral-200 transition-colors hover:border-neutral-500 hover:bg-neutral-900"
        >
          {status?.codex.loggedIn ? "Reconnect" : "Connect via device code"}
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
