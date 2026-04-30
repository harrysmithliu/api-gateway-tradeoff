export type SimulationStatus = "idle" | "running" | "paused" | "stopping";

export type ClientIdMode = "single" | "rotating";

export type TokenBucketSimulationConfig = {
  capacity: number;
  refillRatePerSec: number;
  tokensPerRequest: number;
  rps: number;
  durationSec: number;
  concurrency: number;
  clientIdMode: ClientIdMode;
  singleClientId: string;
  rotatingPoolSize: number;
};

export type TokenBucketSimulationPayload = {
  clientId: string;
  runId?: string;
};

export type TokenBucketAlgorithmState = {
  count: number;
  windowStartMs: number;
  windowSizeSec: number;
  stateSchemaVersion: number | null;
  tokens: number;
  capacity: number;
  refillRatePerSec: number;
  tokensPerRequest: number;
  lastRefillMs: number;
};

export type TokenBucketDecision = {
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
  algorithmState: TokenBucketAlgorithmState | null;
};

export type EventSeverity = "info" | "warning" | "error";

export type TokenBucketIssue = {
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

export type TokenBucketEvent = {
  id: string;
  ts: string;
  kind: "decision" | "synthetic_error";
  decision: TokenBucketDecision | null;
  issues: TokenBucketIssue[];
};

export type TokenBucketKpiSnapshot = {
  total: number;
  allowed: number;
  rejected: number;
  allowRate: number;
  rejectRate: number;
  currentTokens: number | null;
  currentCapacity: number;
  currentRefillRatePerSec: number;
  currentTokensPerRequest: number;
  currentRequestBudget: number | null;
  observedRps: number;
  lastRetryAfterMs: number | null;
};

export type TokenBucketApiResult = {
  event: TokenBucketEvent;
};

export type TokenBucketPolicySnapshot = {
  id: string;
  name: string;
  algorithm: "token_bucket";
  capacity: number;
  refillRatePerSec: number;
  tokensPerRequest: number;
  enabled: boolean;
  version: number;
  description: string | null;
  updatedAt: string;
};

export type PolicySyncStatus = "idle" | "loading" | "ready" | "syncing" | "error";

export const DEFAULT_TOKEN_BUCKET_CONFIG: TokenBucketSimulationConfig = {
  capacity: 20,
  refillRatePerSec: 2,
  tokensPerRequest: 1,
  rps: 20,
  durationSec: 20,
  concurrency: 4,
  clientIdMode: "single",
  singleClientId: "client-a",
  rotatingPoolSize: 10,
};

export const UI_EVENT_CAP = 2000;
