export type SimulationStatus = "idle" | "running" | "paused" | "stopping";

export type ClientIdMode = "single" | "rotating";

export type LeakyBucketSimulationConfig = {
  capacity: number;
  leakRatePerSec: number;
  waterPerRequest: number;
  rps: number;
  durationSec: number;
  concurrency: number;
  clientIdMode: ClientIdMode;
  singleClientId: string;
  rotatingPoolSize: number;
};

export type LeakyBucketSimulationPayload = {
  clientId: string;
  runId?: string;
};

export type LeakyBucketAlgorithmState = {
  count: number;
  windowStartMs: number;
  windowSizeSec: number;
  stateSchemaVersion: number | null;
  waterLevel: number;
  capacity: number;
  leakRatePerSec: number;
  waterPerRequest: number;
  lastLeakMs: number;
};

export type LeakyBucketDecision = {
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
  algorithmState: LeakyBucketAlgorithmState | null;
};

export type EventSeverity = "info" | "warning" | "error";

export type LeakyBucketIssue = {
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

export type LeakyBucketEvent = {
  id: string;
  ts: string;
  kind: "decision" | "synthetic_error";
  decision: LeakyBucketDecision | null;
  issues: LeakyBucketIssue[];
};

export type LeakyBucketKpiSnapshot = {
  total: number;
  allowed: number;
  rejected: number;
  allowRate: number;
  rejectRate: number;
  currentWaterLevel: number | null;
  currentCapacity: number;
  currentLeakRatePerSec: number;
  currentWaterPerRequest: number;
  currentHeadroom: number | null;
  observedRps: number;
  lastRetryAfterMs: number | null;
};

export type LeakyBucketApiResult = {
  event: LeakyBucketEvent;
};

export type LeakyBucketPolicySnapshot = {
  id: string;
  name: string;
  algorithm: "leaky_bucket";
  capacity: number;
  leakRatePerSec: number;
  waterPerRequest: number;
  enabled: boolean;
  version: number;
  description: string | null;
  updatedAt: string;
};

export type PolicySyncStatus = "idle" | "loading" | "ready" | "syncing" | "error";

export const DEFAULT_LEAKY_BUCKET_CONFIG: LeakyBucketSimulationConfig = {
  capacity: 20,
  leakRatePerSec: 2,
  waterPerRequest: 1,
  rps: 20,
  durationSec: 20,
  concurrency: 4,
  clientIdMode: "single",
  singleClientId: "client-a",
  rotatingPoolSize: 10,
};

export const UI_EVENT_CAP = 2000;
