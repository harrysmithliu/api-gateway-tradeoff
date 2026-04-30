export type SimulationStatus = "idle" | "running" | "paused" | "stopping";

export type ClientIdMode = "single" | "rotating";

export type SlidingWindowCounterSimulationConfig = {
  limit: number;
  windowSizeSec: number;
  rps: number;
  durationSec: number;
  concurrency: number;
  clientIdMode: ClientIdMode;
  singleClientId: string;
  rotatingPoolSize: number;
};

export type SlidingWindowCounterSimulationPayload = {
  clientId: string;
  runId?: string;
};

export type SlidingWindowCounterAlgorithmState = {
  count: number;
  windowStartMs: number;
  windowSizeSec: number;
  currentWindowCount: number;
  previousWindowCount: number;
  previousWindowWeight: number;
  estimatedCount: number;
  stateSchemaVersion: number | null;
};

export type SlidingWindowCounterDecision = {
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
  algorithmState: SlidingWindowCounterAlgorithmState | null;
};

export type EventSeverity = "info" | "warning" | "error";

export type SlidingWindowCounterIssue = {
  code:
    | "unexpected_algorithm"
    | "missing_algorithm_state"
    | "partial_algorithm_state"
    | "missing_state_schema_version"
    | "unexpected_retry_after_on_allow"
    | "request_error"
    | "invalid_response";
  severity: EventSeverity;
  message: string;
};

export type SlidingWindowCounterEvent = {
  id: string;
  ts: string;
  kind: "decision" | "synthetic_error";
  decision: SlidingWindowCounterDecision | null;
  issues: SlidingWindowCounterIssue[];
};

export type SlidingWindowCounterKpiSnapshot = {
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
  previousContributionRatio: number | null;
};

export type SlidingWindowCounterApiResult = {
  event: SlidingWindowCounterEvent;
};

export type SlidingWindowCounterPolicySnapshot = {
  id: string;
  name: string;
  algorithm: "sliding_window_counter";
  limit: number;
  windowSizeSec: number;
  enabled: boolean;
  version: number;
  description: string | null;
  updatedAt: string;
};

export type PolicySyncStatus = "idle" | "loading" | "ready" | "syncing" | "error";

export const DEFAULT_SLIDING_WINDOW_COUNTER_CONFIG: SlidingWindowCounterSimulationConfig = {
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
