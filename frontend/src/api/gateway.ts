import { requestJson } from "./client";
import type {
  ExperimentRun,
  LogsResponse,
  MetricsSummary,
  Policy,
  PolicyDraft,
  SimulateBurstResult,
  SimulateDecision,
  TimeseriesPoint,
} from "../types";

export const listPolicies = async (): Promise<Policy[]> => requestJson<Policy[]>("/api/policies");

export const getActivePolicy = async (): Promise<Policy> => requestJson<Policy>("/api/policies/active");

export const createPolicy = async (draft: PolicyDraft): Promise<Policy> =>
  requestJson<Policy>("/api/policies", "POST", {
    name: draft.name,
    algorithm: draft.algorithm,
    params_json: draft.params_json,
    enabled: draft.enabled,
    description: draft.description || null,
  });

export const updatePolicy = async (draft: PolicyDraft): Promise<Policy> => {
  if (!draft.id) {
    throw new Error("Policy id is required for update.");
  }
  return requestJson<Policy>(`/api/policies/${draft.id}`, "PUT", {
    name: draft.name,
    algorithm: draft.algorithm,
    params_json: draft.params_json,
    enabled: draft.enabled,
    description: draft.description || null,
  });
};

export const activatePolicy = async (policyId: string, resetRuntimeState: boolean): Promise<Policy> =>
  requestJson<Policy>(
    `/api/policies/${policyId}/activate?reset_runtime_state=${resetRuntimeState ? "true" : "false"}`,
    "POST",
  );

export const simulateOneRequest = async (clientId: string, runId?: string): Promise<SimulateDecision> =>
  requestJson<SimulateDecision>(
    "/api/simulate/request",
    "POST",
    {
      client_id: clientId,
      run_id: runId,
    },
    { allowedStatuses: [429] },
  );

export const simulateBurst = async (payload: {
  totalRequests: number;
  clientIdMode: "single" | "rotating";
  clientId: string;
  rotatePoolSize: number;
  intervalMs: number;
  runId?: string;
}): Promise<SimulateBurstResult> =>
  requestJson<SimulateBurstResult>("/api/simulate/burst", "POST", {
    total_requests: payload.totalRequests,
    client_id_mode: payload.clientIdMode,
    client_id: payload.clientId,
    rotate_pool_size: payload.rotatePoolSize,
    interval_ms: payload.intervalMs,
    run_id: payload.runId,
  });

export const getMetricsSummary = async (windowSec: number, runId?: string): Promise<MetricsSummary> =>
  requestJson<MetricsSummary>(`/api/metrics/summary?window_sec=${windowSec}${runId ? `&run_id=${runId}` : ""}`);

export const getMetricsTimeseries = async (
  windowSec: number,
  stepSec: number,
  runId?: string,
): Promise<TimeseriesPoint[]> =>
  requestJson<TimeseriesPoint[]>(
    `/api/metrics/timeseries?window_sec=${windowSec}&step_sec=${stepSec}${runId ? `&run_id=${runId}` : ""}`,
  );

export const getLogs = async (
  cursor: number,
  limit: number,
  rejectedOnly: boolean,
  runId?: string,
): Promise<LogsResponse> =>
  requestJson<LogsResponse>(
    `/api/logs?cursor=${cursor}&limit=${limit}&rejected_only=${rejectedOnly ? "true" : "false"}${runId ? `&run_id=${runId}` : ""}`,
  );

export const createRun = async (payload: {
  name: string;
  policyId: string;
  scenario: Record<string, unknown>;
}): Promise<ExperimentRun> =>
  requestJson<ExperimentRun>("/api/runs", "POST", {
    name: payload.name,
    policy_id: payload.policyId,
    scenario_json: payload.scenario,
  });

export const completeRun = async (
  runId: string,
  status: "completed" | "failed" = "completed",
): Promise<ExperimentRun> => requestJson<ExperimentRun>(`/api/runs/${runId}/complete`, "POST", { status });

export const listRuns = async (): Promise<ExperimentRun[]> => requestJson<ExperimentRun[]>("/api/runs");
