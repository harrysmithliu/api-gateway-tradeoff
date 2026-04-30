export type SimulationStatus = "idle" | "running" | "paused" | "stopping";

export type ClientIdMode = "single" | "rotating";

export type FixedWindowSimulationConfig = {
  limit: number;
  windowSizeSec: number;
  rps: number;
  durationSec: number;
  concurrency: number;
  clientIdMode: ClientIdMode;
  singleClientId: string;
  rotatingPoolSize: number;
};

export type FixedWindowSimulationPayload = {
  clientId: string;
  runId?: string;
};

export type FixedWindowAlgorithmState = {
  count: number;
  windowStartMs: number;
  windowSizeSec: number;
};

export type FixedWindowDecision = {
  requestId: string;
  ts: string;
  policyId: string;
  algorithm: string;
  allowed: boolean;
  reason: string | null;
  retryAfterMs: number | null;
  latencyMs: number;
  remaining: number | null;
  clientId: string;
  runId: string | null;
  algorithmState: FixedWindowAlgorithmState | null;
};

export type EventSeverity = "info" | "warning" | "error";

export type FixedWindowIssue = {
  code:
    | "unexpected_algorithm"
    | "missing_algorithm_state"
    | "partial_algorithm_state"
    | "request_error"
    | "invalid_response";
  severity: EventSeverity;
  message: string;
};

export type FixedWindowEvent = {
  id: string;
  ts: string;
  kind: "decision" | "synthetic_error";
  decision: FixedWindowDecision | null;
  issues: FixedWindowIssue[];
};

export type FixedWindowKpiSnapshot = {
  total: number;
  allowed: number;
  rejected: number;
  allowRate: number;
  rejectRate: number;
  currentCount: number | null;
  currentLimit: number;
  currentRemaining: number | null;
  currentWindowStartMs: number | null;
  currentWindowEndMs: number | null;
  observedRps: number;
  lastRetryAfterMs: number | null;
};

export type FixedWindowBoundary = {
  windowStartMs: number;
  windowEndMs: number;
};

export type FixedWindowApiResult = {
  event: FixedWindowEvent;
};

export type FixedWindowPolicySnapshot = {
  id: string;
  name: string;
  algorithm: "fixed_window";
  limit: number;
  windowSizeSec: number;
  enabled: boolean;
  version: number;
  description: string | null;
  updatedAt: string;
};

export type PolicySyncStatus = "idle" | "loading" | "ready" | "syncing" | "error";

export const DEFAULT_FIXED_WINDOW_CONFIG: FixedWindowSimulationConfig = {
  limit: 10,
  windowSizeSec: 10,
  rps: 20,
  durationSec: 20,
  concurrency: 4,
  clientIdMode: "single",
  singleClientId: "client-a",
  rotatingPoolSize: 10,
};

export const UI_EVENT_CAP = 2000;
