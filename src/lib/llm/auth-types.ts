export type CodexTokens = {
  access: string;
  refresh: string;
  expiresAt: number;
  accountID: string | null;
  planType: string | null;
};

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

export type DeviceFlow = {
  deviceAuthId: string;
  userCode: string;
  expiresAt: number;
  intervalMs: number;
  nextPollAt: number;
  result: DeviceLoginPoll;
};

export type AuthOperation =
  | { op: "read" }
  | { op: "write"; tokens: CodexTokens }
  | { op: "start" }
  | { op: "poll"; flowId: string }
  | { op: "refresh"; current: CodexTokens };

export interface AuthNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

export type AuthBindings = { SEEM_BOX_AUTH?: AuthNamespace };
