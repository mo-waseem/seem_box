import { AppError } from "../lib/errors";
import { advanceDeviceFlow, createDeviceFlow, expiredFlow, refreshCodexTokens } from "../lib/llm/auth-oauth";
import type { AuthOperation, CodexTokens, DeviceFlow } from "../lib/llm/auth-types";

export interface AuthStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(entries: Record<string, unknown>): Promise<void>;
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
  delete(keys: string[]): Promise<number>;
  setAlarm(time: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}

export interface AuthState { storage: AuthStorage }

// Cloudflare guarantees one live instance per object. The queue also covers awaits
// during upstream requests without holding blockConcurrencyWhile's 30s lock.
export class AuthObject {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly storage: AuthStorage;

  constructor(state: AuthState) {
    this.storage = state.storage;
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.queue.then(operation);
    this.queue = task.catch(() => undefined);
    return task;
  }

  fetch(request: Request): Promise<Response> {
    return this.serialize(async () => {
      try {
        if (request.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
        const operation = await request.json() as AuthOperation;
        return Response.json(await this.execute(operation));
      } catch (error) {
        return Response.json({ error: "Authentication operation failed. Try again." }, {
          status: error instanceof AppError ? error.status : 503,
        });
      }
    });
  }

  alarm(): Promise<void> {
    return this.serialize(() => this.cleanup());
  }

  private async cleanup(): Promise<void> {
    const flows = await this.storage.list<DeviceFlow>({ prefix: "flow:" });
    const expired: string[] = [];
    let next = Infinity;
    for (const [key, flow] of flows) {
      if (Date.now() >= flow.expiresAt) expired.push(key);
      else next = Math.min(next, flow.expiresAt);
    }
    if (expired.length) await this.storage.delete(expired);
    if (Number.isFinite(next)) await this.storage.setAlarm(next);
    else await this.storage.deleteAlarm();
  }

  private async execute(operation: AuthOperation): Promise<unknown> {
    switch (operation.op) {
      case "read":
        return (await this.storage.get<CodexTokens>("tokens")) ?? null;
      case "write":
        await this.storage.put({ tokens: operation.tokens });
        return null;
      case "start": {
        await this.cleanup();
        const { start, flow } = await createDeviceFlow();
        // Arm before writing so a crash cannot leave an uncollected flow.
        const existing = await this.storage.list<DeviceFlow>({ prefix: "flow:" });
        await this.storage.setAlarm(Math.min(flow.expiresAt, ...Array.from(existing.values(), (f) => f.expiresAt)));
        await this.storage.put({ [`flow:${start.flowId}`]: flow });
        return start;
      }
      case "poll": {
        const key = `flow:${operation.flowId}`;
        const flow = await this.storage.get<DeviceFlow>(key);
        if (!flow || Date.now() >= flow.expiresAt) {
          if (flow) await this.storage.delete([key]);
          return expiredFlow;
        }
        if (flow.result.status !== "pending" || Date.now() < flow.nextPollAt) return flow.result;
        const { result, tokens } = await advanceDeviceFlow(flow);
        const next: DeviceFlow = { ...flow, result, nextPollAt: Date.now() + flow.intervalMs };
        // One atomic multi-key write: a successful poll always has saved tokens.
        await this.storage.put({ [key]: next, ...(tokens ? { tokens } : {}) });
        return result;
      }
      case "refresh": {
        const saved = await this.storage.get<CodexTokens>("tokens");
        if (!saved) throw new AppError("ChatGPT is not connected.", 503);
        const current = operation.current;
        if (saved.access !== current.access || saved.refresh !== current.refresh || saved.accountID !== current.accountID || saved.expiresAt !== current.expiresAt) return saved;
        const fresh = await refreshCodexTokens(saved.refresh);
        const tokens: CodexTokens = { ...fresh, accountID: fresh.accountID ?? saved.accountID, planType: fresh.planType ?? saved.planType };
        await this.storage.put({ tokens });
        return tokens;
      }
      default:
        throw new AppError("Unknown authentication operation.", 400);
    }
  }
}
