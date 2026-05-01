import type {
  LeakyBucketAlgorithmState,
  LeakyBucketApiResult,
  LeakyBucketDecision,
  LeakyBucketIssue,
  LeakyBucketPolicySnapshot,
  LeakyBucketSimulationPayload,
} from "../types/leakyBucket";
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
  toPositiveFloatOrNull,
  toPositiveIntOrNull,
  toStringOrNull,
  updatePolicyRaw,
} from "./common";

export { ApiError } from "./common";

const DASHBOARD_POLICY_NAME = "leaky-bucket-dashboard";

const createIssue = (issue: LeakyBucketIssue): LeakyBucketIssue => issue;

const mapAlgorithmState = (raw: unknown): { state: LeakyBucketAlgorithmState | null; issues: LeakyBucketIssue[] } => {
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
  const stateSchemaVersion = toNumberOrNull(raw.state_schema_version);
  const waterLevel = toNumberOrNull(raw.water_level);
  const capacity = toPositiveIntOrNull(raw.capacity);
  const leakRatePerSec = toPositiveFloatOrNull(raw.leak_rate_per_sec);
  const waterPerRequest = toPositiveIntOrNull(raw.water_per_request);
  const lastLeakMs = toNumberOrNull(raw.last_leak_ms);

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
  if (waterLevel === null) {
    missingFields.push("water_level");
  }
  if (capacity === null) {
    missingFields.push("capacity");
  }
  if (leakRatePerSec === null) {
    missingFields.push("leak_rate_per_sec");
  }
  if (waterPerRequest === null) {
    missingFields.push("water_per_request");
  }
  if (lastLeakMs === null) {
    missingFields.push("last_leak_ms");
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
      stateSchemaVersion,
      waterLevel: waterLevel as number,
      capacity: capacity as number,
      leakRatePerSec: leakRatePerSec as number,
      waterPerRequest: waterPerRequest as number,
      lastLeakMs: lastLeakMs as number,
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
): { decision: LeakyBucketDecision | null; issues: LeakyBucketIssue[] } => {
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
  if (algorithm !== "leaky_bucket") {
    issues.push(
      createIssue({
        code: "unexpected_algorithm",
        severity: "warning",
        message: `Expected leaky_bucket but received ${algorithm}.`,
      }),
    );
  }

  const decision: LeakyBucketDecision = {
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

const createSyntheticErrorResult = (message: string): LeakyBucketApiResult => {
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

const mapPolicySnapshot = (raw: PolicyRaw): LeakyBucketPolicySnapshot | null => {
  if (typeof raw.id !== "string" || typeof raw.name !== "string") {
    return null;
  }
  if (raw.algorithm !== "leaky_bucket") {
    return null;
  }
  if (!isRecord(raw.params_json)) {
    return null;
  }

  const capacity = toPositiveIntOrNull(raw.params_json.capacity);
  const leakRatePerSec = toPositiveFloatOrNull(raw.params_json.leak_rate_per_sec);
  const waterPerRequest = toPositiveIntOrNull(raw.params_json.water_per_request) ?? 1;
  if (capacity === null || leakRatePerSec === null) {
    return null;
  }

  return {
    id: raw.id,
    name: raw.name,
    algorithm: "leaky_bucket",
    capacity,
    leakRatePerSec,
    waterPerRequest,
    enabled: raw.enabled === true,
    version: typeof raw.version === "number" ? raw.version : 1,
    description: typeof raw.description === "string" ? raw.description : null,
    updatedAt: typeof raw.updated_at === "string" ? raw.updated_at : new Date().toISOString(),
  };
};

const listPolicies = async (): Promise<LeakyBucketPolicySnapshot[]> => {
  const payload = await listPoliciesRaw();
  return payload.map(mapPolicySnapshot).filter((item): item is LeakyBucketPolicySnapshot => item !== null);
};

const getActivePolicy = async (): Promise<LeakyBucketPolicySnapshot | null> => {
  const payload = await getActivePolicyRaw();
  if (!payload) {
    return null;
  }
  return mapPolicySnapshot(payload);
};

const createPolicy = async (params: {
  name: string;
  capacity: number;
  leakRatePerSec: number;
  waterPerRequest: number;
}): Promise<LeakyBucketPolicySnapshot> => {
  const payload = await createPolicyRaw({
    name: params.name,
    algorithm: "leaky_bucket",
    paramsJson: {
      capacity: params.capacity,
      leak_rate_per_sec: params.leakRatePerSec,
      water_per_request: params.waterPerRequest,
    },
    description: "Managed by leaky-bucket dashboard",
  });

  const mapped = mapPolicySnapshot(payload);
  if (!mapped) {
    throw new ApiError("Failed to parse created policy response.", 500);
  }
  return mapped;
};

const updatePolicy = async (
  policyId: string,
  params: { capacity: number; leakRatePerSec: number; waterPerRequest: number },
): Promise<LeakyBucketPolicySnapshot> => {
  const payload = await updatePolicyRaw({
    policyId,
    algorithm: "leaky_bucket",
    paramsJson: {
      capacity: params.capacity,
      leak_rate_per_sec: params.leakRatePerSec,
      water_per_request: params.waterPerRequest,
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

export const syncLeakyBucketPolicyConfig = async (params: {
  capacity: number;
  leakRatePerSec: number;
  waterPerRequest: number;
  resetRuntimeState: boolean;
}): Promise<LeakyBucketPolicySnapshot> => {
  return syncDashboardPolicy({
    dashboardPolicyName: DASHBOARD_POLICY_NAME,
    config: {
      capacity: params.capacity,
      leakRatePerSec: params.leakRatePerSec,
      waterPerRequest: params.waterPerRequest,
    },
    resetRuntimeState: params.resetRuntimeState,
    getActivePolicy,
    listPolicies,
    updatePolicy,
    createPolicy: (name, config) =>
      createPolicy({
        name,
        capacity: config.capacity,
        leakRatePerSec: config.leakRatePerSec,
        waterPerRequest: config.waterPerRequest,
      }),
    activatePolicy,
  });
};

export const fetchActiveLeakyBucketPolicy = async (): Promise<LeakyBucketPolicySnapshot | null> => getActivePolicy();

export const simulateLeakyBucketRequest = async (
  payload: LeakyBucketSimulationPayload,
): Promise<LeakyBucketApiResult> => {
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
