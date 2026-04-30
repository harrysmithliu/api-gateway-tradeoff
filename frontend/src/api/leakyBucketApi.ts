import type {
  LeakyBucketAlgorithmState,
  LeakyBucketApiResult,
  LeakyBucketDecision,
  LeakyBucketIssue,
  LeakyBucketPolicySnapshot,
  LeakyBucketSimulationPayload,
} from "../types/leakyBucket";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const REQUEST_TIMEOUT_MS = 10_000;
const DASHBOARD_POLICY_NAME = "leaky-bucket-dashboard";

type SimulateRequestRaw = {
  request_id?: unknown;
  ts?: unknown;
  policy_id?: unknown;
  algorithm?: unknown;
  allowed?: unknown;
  reason?: unknown;
  retry_after_ms?: unknown;
  latency_ms?: unknown;
  remaining?: unknown;
  client_id?: unknown;
  run_id?: unknown;
  algorithm_state?: unknown;
};

type PolicyRaw = {
  id?: unknown;
  name?: unknown;
  algorithm?: unknown;
  params_json?: unknown;
  enabled?: unknown;
  version?: unknown;
  description?: unknown;
  updated_at?: unknown;
};

type HttpMethod = "GET" | "POST" | "PUT";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toStringOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return value;
};

const toPositiveIntOrNull = (value: unknown): number | null => {
  const numberValue = toNumberOrNull(value);
  if (numberValue === null || numberValue <= 0) {
    return null;
  }
  return Math.floor(numberValue);
};

const toPositiveFloatOrNull = (value: unknown): number | null => {
  const numberValue = toNumberOrNull(value);
  if (numberValue === null || numberValue <= 0) {
    return null;
  }
  return numberValue;
};

const createIssue = (issue: LeakyBucketIssue): LeakyBucketIssue => issue;

const requestJson = async <T>(
  path: string,
  method: HttpMethod = "GET",
  body?: unknown,
): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const messageFromDetail = isRecord(payload) && typeof payload.detail === "string" ? payload.detail : null;
    const messageFromError = isRecord(payload) && typeof payload.error === "string" ? payload.error : null;
    const message = messageFromDetail ?? messageFromError ?? `Request failed with status ${response.status}.`;
    throw new ApiError(message, response.status);
  }

  return payload as T;
};

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
  const payload = await requestJson<PolicyRaw[]>("/api/policies");
  return payload.map(mapPolicySnapshot).filter((item): item is LeakyBucketPolicySnapshot => item !== null);
};

const getActivePolicy = async (): Promise<LeakyBucketPolicySnapshot | null> => {
  try {
    const payload = await requestJson<PolicyRaw>("/api/policies/active");
    return mapPolicySnapshot(payload);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
};

const createPolicy = async (params: {
  name: string;
  capacity: number;
  leakRatePerSec: number;
  waterPerRequest: number;
}): Promise<LeakyBucketPolicySnapshot> => {
  const payload = await requestJson<PolicyRaw>("/api/policies", "POST", {
    name: params.name,
    algorithm: "leaky_bucket",
    params_json: {
      capacity: params.capacity,
      leak_rate_per_sec: params.leakRatePerSec,
      water_per_request: params.waterPerRequest,
    },
    enabled: true,
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
  const payload = await requestJson<PolicyRaw>(`/api/policies/${policyId}`, "PUT", {
    algorithm: "leaky_bucket",
    params_json: {
      capacity: params.capacity,
      leak_rate_per_sec: params.leakRatePerSec,
      water_per_request: params.waterPerRequest,
    },
    enabled: true,
  });

  const mapped = mapPolicySnapshot(payload);
  if (!mapped) {
    throw new ApiError("Failed to parse updated policy response.", 500);
  }
  return mapped;
};

const activatePolicy = async (policyId: string, resetRuntimeState: boolean): Promise<void> => {
  await requestJson(`/api/policies/${policyId}/activate?reset_runtime_state=${resetRuntimeState ? "true" : "false"}`, "POST");
};

export const syncLeakyBucketPolicyConfig = async (params: {
  capacity: number;
  leakRatePerSec: number;
  waterPerRequest: number;
  resetRuntimeState: boolean;
}): Promise<LeakyBucketPolicySnapshot> => {
  const active = await getActivePolicy();

  let targetPolicy: LeakyBucketPolicySnapshot;
  if (active && active.enabled) {
    targetPolicy = await updatePolicy(active.id, {
      capacity: params.capacity,
      leakRatePerSec: params.leakRatePerSec,
      waterPerRequest: params.waterPerRequest,
    });
  } else {
    const candidates = await listPolicies();
    const existingManaged = candidates.find((item) => item.name === DASHBOARD_POLICY_NAME);

    if (existingManaged) {
      targetPolicy = await updatePolicy(existingManaged.id, {
        capacity: params.capacity,
        leakRatePerSec: params.leakRatePerSec,
        waterPerRequest: params.waterPerRequest,
      });
    } else {
      targetPolicy = await createPolicy({
        name: DASHBOARD_POLICY_NAME,
        capacity: params.capacity,
        leakRatePerSec: params.leakRatePerSec,
        waterPerRequest: params.waterPerRequest,
      });
    }
  }

  await activatePolicy(targetPolicy.id, params.resetRuntimeState);
  const latest = await getActivePolicy();
  if (!latest) {
    throw new ApiError("Failed to read active policy after activation.", 500);
  }
  return latest;
};

export const fetchActiveLeakyBucketPolicy = async (): Promise<LeakyBucketPolicySnapshot | null> => getActivePolicy();

export const simulateLeakyBucketRequest = async (
  payload: LeakyBucketSimulationPayload,
): Promise<LeakyBucketApiResult> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}/api/simulate/request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: payload.clientId,
        run_id: payload.runId,
      }),
      signal: controller.signal,
    });

    let responseBody: unknown = null;
    try {
      responseBody = await response.json();
    } catch {
      return createSyntheticErrorResult("Backend returned a non-JSON response.");
    }

    const mapped = mapDecision(responseBody, payload.clientId);

    if (!response.ok && response.status !== 429) {
      const errorMessage = mapped.issues[0]?.message ?? `Request failed with status ${response.status}.`;
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
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return createSyntheticErrorResult("Request timeout while calling simulate endpoint.");
    }
    if (error instanceof Error) {
      return createSyntheticErrorResult(`Request error: ${error.message}`);
    }
    return createSyntheticErrorResult("Unknown request error.");
  } finally {
    clearTimeout(timeout);
  }
};

export const getFrontendApiBaseUrl = (): string => API_BASE_URL;
