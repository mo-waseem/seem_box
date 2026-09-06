import "server-only";
import { writeCodexTokens } from "./token-store";
import { cloudflareAuth, usesCloudflareAuth } from "./auth-cloudflare";
import { advanceDeviceFlow, createDeviceFlow, expiredFlow } from "./auth-oauth";
import type { DeviceFlow, DeviceLoginPoll, DeviceLoginStart } from "./auth-types";

export { parseTokenClaims, refreshCodexTokens } from "./auth-oauth";
export type { DeviceLoginStart, DeviceLoginPoll } from "./auth-types";

const flows = new Map<string, DeviceFlow>();
let queue: Promise<unknown> = Promise.resolve();

export async function startDeviceLogin(): Promise<DeviceLoginStart> {
  if (usesCloudflareAuth()) return cloudflareAuth({ op: "start" });
  for (const [id, flow] of flows) if (Date.now() >= flow.expiresAt) flows.delete(id);
  const { start, flow } = await createDeviceFlow();
  flows.set(start.flowId, flow);
  return start;
}

export async function pollDeviceLogin(flowId: string): Promise<DeviceLoginPoll> {
  if (usesCloudflareAuth()) return cloudflareAuth({ op: "poll", flowId });
  const task = queue.then(async (): Promise<DeviceLoginPoll> => {
    const flow = flows.get(flowId);
    if (!flow || Date.now() >= flow.expiresAt) {
      flows.delete(flowId);
      return expiredFlow;
    }
    if (flow.result.status !== "pending" || Date.now() < flow.nextPollAt) return flow.result;
    const { result, tokens } = await advanceDeviceFlow(flow);
    if (tokens) await writeCodexTokens(tokens);
    flow.result = result;
    flow.nextPollAt = Date.now() + flow.intervalMs;
    return result;
  });
  queue = task.catch(() => undefined);
  return task;
}
