import type {
  SlidingWindowCounterAlgorithmState,
  SlidingWindowCounterApiResult,
  SlidingWindowCounterDecision,
  SlidingWindowCounterIssue,
  SlidingWindowCounterPolicySnapshot,
  SlidingWindowCounterSimulationPayload,
} from "../types/slidingWindowCounter";
import {
  API_BASE_URL,
  ApiError,
  activatePolicyRaw,
  createPolicyRaw,
  getActivePolicyRaw,
  isRecord,
  listPoliciesRaw,
  postSimulateRequest,
  SimulateRequestRaw,
  type PolicyRaw,
  syncDashboardPolicy,
  toNumberOrNull,
  toPositiveIntOrNull,
  toStringOrNull,
  updatePolicyRaw,
} from "./common";

export { ApiError } from "./common";

const DASHBOARD_POLICY_NAME = "sliding-window-counter-dashboard";

const createIssue = (issue: SlidingWindowCounterIssue): SlidingWindowCounterIssue => issue;

const mapAlgorithmState = (raw: unknown): { state: SlidingWindowCounterAlgorithmState | null; issues: SlidingWindowCounterIssue[] } => {
  if (!isRecord(raw)) {
    return {
      state: null,
      issues: [
        createIssue({
          code: "missing_algorithm_state",
          severity: "warning",
          message: "algorithm_state is missing or not an object.",
        }),
      ],
    };
  }

  const count = toNumberOrNull(raw.count);
  const windowStartMs = toNumberOrNull(raw.window_start_ms);
  const windowSizeSec = toNumberOrNull(raw.window_size_sec);
  const currentWindowCount = toNumberOrNull(raw.current_window_count);
  const previousWindowCount = toNumberOrNull(raw.previous_window_count);
  const previousWindowWeight = toNumberOrNull(raw.previous_window_weight);
  const estimatedCount = toNumberOrNull(raw.estimated_count);
  const stateSchemaVersion = toNumberOrNull(raw.state_schema_version);

  const missingFields: string[] = [];
  if (count === null) {
    missingFields.push("count");
  }
  if (windowStartMs === null) {
    missingFields.push("window_start_ms");
  }
  if (windowSizeSec === null) {
    missingFields.push("window_size_sec");
  }
  if (currentWindowCount === null) {
    missingFields.push("current_window_count");
  }
  if (previousWindowCount === null) {
    missingFields.push("previous_window_count");
  }
  if (previousWindowWeight === null) {
    missingFields.push("previous_window_weight");
  }
  if (estimatedCount === null) {
    missingFields.push("estimated_count");
  }

  if (missingFields.length > 0) {
    return {
      state: null,
      issues: [
        createIssue({
          code: "partial_algorithm_state",
          severity: "warning",
          message: `algorithm_state is missing fields: ${missingFields.join(", ")}.`,
        }),
      ],
    };
  }

  return {
    state: {
      count: count as number,
      windowStartMs: windowStartMs as number,
      windowSizeSec: windowSizeSec as number,
      currentWindowCount: currentWindowCount as number,
      previousWindowCount: previousWindowCount as number,
      previousWindowWeight: previousWindowWeight as number,
      estimatedCount: estimatedCount as number,
      stateSchemaVersion,
    },
    issues:
      stateSchemaVersion === null
        ? [
            createIssue({
              code: "missing_state_schema_version",
              severity: "warning",
              message: "algorithm_state.state_schema_version is missing.",
            }),
          ]
        : [],
  };
};

const mapDecision = (
  raw: unknown,
  fallbackClientId: string,
): { decision: SlidingWindowCounterDecision | null; issues: SlidingWindowCounterIssue[] } => {
  if (!isRecord(raw)) {
    return {
      decision: null,
      issues: [
        createIssue({
          code: "invalid_response",
          severity: "error",
          message: "Backend response is not a valid JSON object.",
        }),
      ],
    };
  }

  const data = raw as SimulateRequestRaw;

  const requiredStringFields: Array<[string, unknown]> = [
    ["request_id", data.request_id],
    ["ts", data.ts],
    ["policy_id", data.policy_id],
  ];
  const requiredNumberFields: Array<[string, unknown]> = [["latency_ms", data.latency_ms]];

  const invalidFields: string[] = [];
  requiredStringFields.forEach(([name, value]) => {
    if (typeof value !== "string") {
      invalidFields.push(name);
    }
  });
  requiredNumberFields.forEach(([name, value]) => {
    if (typeof value !== "number" || Number.isNaN(value)) {
      invalidFields.push(name);
    }
  });
  if (typeof data.allowed !== "boolean") {
    invalidFields.push("allowed");
  }

  if (invalidFields.length > 0) {
    return {
      decision: null,
      issues: [
        createIssue({
          code: "invalid_response",
          severity: "error",
          message: `Backend response has invalid fields: ${invalidFields.join(", ")}.`,
        }),
      ],
    };
  }

  const stateMapping = mapAlgorithmState(data.algorithm_state);
  const issues = [...stateMapping.issues];

  const algorithm = typeof data.algorithm === "string" ? data.algorithm : "unknown";
  if (algorithm !== "sliding_window_counter") {
    issues.push(
      createIssue({
        code: "unexpected_algorithm",
        severity: "warning",
        message: `Expected sliding_window_counter but received ${algorithm}.`,
      }),
    );
  }

  const decision: SlidingWindowCounterDecision = {
    requestId: data.request_id as string,
    ts: data.ts as string,
    policyId: data.policy_id as string,
    algorithm,
    allowed: data.allowed as boolean,
    reason: toStringOrNull(data.reason),
    retryAfterMs: toNumberOrNull(data.retry_after_ms),
    latencyMs: data.latency_ms as number,
    remaining: toNumberOrNull(data.remaining),
    clientId: toStringOrNull(data.client_id) ?? fallbackClientId,
    runId: toStringOrNull(data.run_id),
    algorithmState: stateMapping.state,
  };

  if (decision.allowed && decision.retryAfterMs !== null && decision.retryAfterMs > 0) {
    issues.push(
      createIssue({
        code: "unexpected_retry_after_on_allow",
        severity: "warning",
        message: "retry_after_ms is present on an allowed decision.",
      }),
    );
  }

  return {
    decision,
    issues,
  };
};

const createSyntheticErrorResult = (message: string): SlidingWindowCounterApiResult => {
  const now = new Date().toISOString();
  return {
    event: {
      id: crypto.randomUUID(),
      ts: now,
      kind: "synthetic_error",
      decision: null,
      issues: [
        createIssue({
          code: "request_error",
          severity: "error",
          message,
        }),
      ],
    },
  };
};

const mapPolicySnapshot = (raw: PolicyRaw): SlidingWindowCounterPolicySnapshot | null => {
  if (typeof raw.id !== "string" || typeof raw.name !== "string") {
    return null;
  }
  if (raw.algorithm !== "sliding_window_counter") {
    return null;
  }
  if (!isRecord(raw.params_json)) {
    return null;
  }

  const limit = toPositiveIntOrNull(raw.params_json.limit);
  const windowSizeSec = toPositiveIntOrNull(raw.params_json.window_size_sec);
  if (limit === null || windowSizeSec === null) {
    return null;
  }

  return {
    id: raw.id,
    name: raw.name,
    algorithm: "sliding_window_counter",
    limit,
    windowSizeSec,
    enabled: raw.enabled === true,
    version: typeof raw.version === "number" ? raw.version : 1,
    description: typeof raw.description === "string" ? raw.description : null,
    updatedAt: typeof raw.updated_at === "string" ? raw.updated_at : new Date().toISOString(),
  };
};

const listPolicies = async (): Promise<SlidingWindowCounterPolicySnapshot[]> => {
  const payload = await listPoliciesRaw();
  return payload.map(mapPolicySnapshot).filter((item): item is SlidingWindowCounterPolicySnapshot => item !== null);
};

const getActivePolicy = async (): Promise<SlidingWindowCounterPolicySnapshot | null> => {
  const payload = await getActivePolicyRaw();
  if (!payload) {
    return null;
  }
  return mapPolicySnapshot(payload);
};

const createPolicy = async (params: { name: string; limit: number; windowSizeSec: number }): Promise<SlidingWindowCounterPolicySnapshot> => {
  const payload = await createPolicyRaw({
    name: params.name,
    algorithm: "sliding_window_counter",
    paramsJson: {
      limit: params.limit,
      window_size_sec: params.windowSizeSec,
    },
    description: "Managed by sliding-window-counter dashboard",
  });

  const mapped = mapPolicySnapshot(payload);
  if (!mapped) {
    throw new ApiError("Failed to parse created policy response.", 500);
  }
  return mapped;
};

const updatePolicy = async (policyId: string, params: { limit: number; windowSizeSec: number }): Promise<SlidingWindowCounterPolicySnapshot> => {
  const payload = await updatePolicyRaw({
    policyId,
    algorithm: "sliding_window_counter",
    paramsJson: {
      limit: params.limit,
      window_size_sec: params.windowSizeSec,
    },
  });

  const mapped = mapPolicySnapshot(payload);
  if (!mapped) {
    throw new ApiError("Failed to parse updated policy response.", 500);
  }
  return mapped;
};

const activatePolicy = async (policyId: string, resetRuntimeState: boolean): Promise<void> => {
  await activatePolicyRaw(policyId, resetRuntimeState);
};

export const syncSlidingWindowCounterPolicyConfig = async (params: {
  limit: number;
  windowSizeSec: number;
  resetRuntimeState: boolean;
}): Promise<SlidingWindowCounterPolicySnapshot> => {
  return syncDashboardPolicy({
    dashboardPolicyName: DASHBOARD_POLICY_NAME,
    config: {
      limit: params.limit,
      windowSizeSec: params.windowSizeSec,
    },
    resetRuntimeState: params.resetRuntimeState,
    getActivePolicy,
    listPolicies,
    updatePolicy,
    createPolicy: (name, config) =>
      createPolicy({
        name,
        limit: config.limit,
        windowSizeSec: config.windowSizeSec,
      }),
    activatePolicy,
  });
};

export const fetchActiveSlidingWindowCounterPolicy = async (): Promise<SlidingWindowCounterPolicySnapshot | null> => getActivePolicy();

export const simulateSlidingWindowCounterRequest = async (
  payload: SlidingWindowCounterSimulationPayload,
): Promise<SlidingWindowCounterApiResult> => {
  const call = await postSimulateRequest({ clientId: payload.clientId, runId: payload.runId });
  if (call.kind === "non_json") {
    return createSyntheticErrorResult("Backend returned a non-JSON response.");
  }
  if (call.kind === "timeout") {
    return createSyntheticErrorResult("Request timeout while calling simulate endpoint.");
  }
  if (call.kind === "network_error") {
    return createSyntheticErrorResult(`Request error: ${call.message}`);
  }

  const mapped = mapDecision(call.result.body, payload.clientId);
  if (!call.result.ok && call.result.status !== 429) {
    const errorMessage = mapped.issues[0]?.message ?? `Request failed with status ${call.result.status}.`;
    return createSyntheticErrorResult(errorMessage);
  }
  if (!mapped.decision) {
    const errorMessage = mapped.issues[0]?.message ?? "Unable to parse decision response.";
    return createSyntheticErrorResult(errorMessage);
  }

  return {
    event: {
      id: mapped.decision.requestId,
      ts: mapped.decision.ts,
      kind: "decision",
      decision: mapped.decision,
      issues: mapped.issues,
    },
  };
};

export const getFrontendApiBaseUrl = (): string => API_BASE_URL;
