export type AlgorithmType =
  | "fixed_window"
  | "sliding_log"
  | "sliding_window_counter"
  | "token_bucket"
  | "leaky_bucket";

export type Policy = {
  id: string;
  name: string;
  algorithm: AlgorithmType;
  params_json: Record<string, number>;
  enabled: boolean;
  version: number;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type PolicyDraft = {
  id: string | null;
  name: string;
  algorithm: AlgorithmType;
  params_json: Record<string, number>;
  enabled: boolean;
  description: string;
};

export type SimulateDecision = {
  request_id: string;
  ts: string;
  policy_id: string;
  algorithm: AlgorithmType;
  allowed: boolean;
  reason: string | null;
  retry_after_ms: number | null;
  latency_ms: number;
  remaining: number | null;
  run_id: string | null;
  client_id: string;
  algorithm_state: Record<string, unknown> | null;
};

export type MetricsSummary = {
  total: number;
  allowed: number;
  rejected: number;
  accept_rate: number;
  reject_rate: number;
  qps: number;
  p50: number;
  p95: number;
  p99: number;
  peak_qps: number;
};

export type TimeseriesPoint = {
  ts: number;
  qps: number;
  allowed: number;
  rejected: number;
  reject_rate: number;
  p99_ms: number;
  peak_delta: number;
};

export type LogsResponse = {
  items: SimulateDecision[];
  next_cursor: number;
  limit: number;
  run_id: string | null;
};

export type RunStatus = "running" | "completed" | "failed";

export type ExperimentRun = {
  id: string;
  name: string;
  policy_id: string;
  scenario_json: Record<string, unknown>;
  started_at: string;
  ended_at: string | null;
  status: RunStatus;
};

export type SimulateBurstResult = {
  total: number;
  allowed: number;
  rejected: number;
  decisions: SimulateDecision[];
};

export type SimulationConfig = {
  mode: "request_loop" | "burst_api";
  rounds: number;
  requestsPerRound: number;
  roundIntervalMs: number;
  concurrency: number;
  clientIdMode: "single" | "rotating";
  singleClientId: string;
  rotatingPoolSize: number;
};

export const ALGORITHM_LABELS: Record<AlgorithmType, string> = {
  fixed_window: "Fixed Window",
  sliding_log: "Sliding Log",
  sliding_window_counter: "Sliding Window Counter",
  token_bucket: "Token Bucket",
  leaky_bucket: "Leaky Bucket",
};

export const DEFAULT_PARAMS_BY_ALGORITHM: Record<AlgorithmType, Record<string, number>> = {
  fixed_window: { window_size_sec: 10, limit: 100 },
  sliding_log: { window_size_sec: 10, limit: 100 },
  sliding_window_counter: { window_size_sec: 10, limit: 100 },
  token_bucket: { capacity: 100, refill_rate_per_sec: 50, tokens_per_request: 1 },
  leaky_bucket: { capacity: 100, leak_rate_per_sec: 40, water_per_request: 1 },
};

export const PARAM_KEYS_BY_ALGORITHM: Record<AlgorithmType, string[]> = {
  fixed_window: ["window_size_sec", "limit"],
  sliding_log: ["window_size_sec", "limit"],
  sliding_window_counter: ["window_size_sec", "limit"],
  token_bucket: ["capacity", "refill_rate_per_sec", "tokens_per_request"],
  leaky_bucket: ["capacity", "leak_rate_per_sec", "water_per_request"],
};
