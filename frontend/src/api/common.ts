export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
export const REQUEST_TIMEOUT_MS = 10_000;

export type SimulateRequestRaw = {
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

export type PolicyRaw = {
  id?: unknown;
  name?: unknown;
  algorithm?: unknown;
  params_json?: unknown;
  enabled?: unknown;
  version?: unknown;
  description?: unknown;
  updated_at?: unknown;
};

export type HttpMethod = "GET" | "POST" | "PUT";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const toStringOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

export const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return value;
};

export const toPositiveIntOrNull = (value: unknown): number | null => {
  const numberValue = toNumberOrNull(value);
  if (numberValue === null || numberValue <= 0) {
    return null;
  }
  return Math.floor(numberValue);
};

export const toPositiveFloatOrNull = (value: unknown): number | null => {
  const numberValue = toNumberOrNull(value);
  if (numberValue === null || numberValue <= 0) {
    return null;
  }
  return numberValue;
};

export const requestJson = async <T>(
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

export const listPoliciesRaw = async (): Promise<PolicyRaw[]> => requestJson<PolicyRaw[]>("/api/policies");

export const getActivePolicyRaw = async (): Promise<PolicyRaw | null> => {
  try {
    return await requestJson<PolicyRaw>("/api/policies/active");
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
};

export const createPolicyRaw = async (input: {
  name: string;
  algorithm: string;
  paramsJson: Record<string, unknown>;
  description: string;
  enabled?: boolean;
}): Promise<PolicyRaw> =>
  requestJson<PolicyRaw>("/api/policies", "POST", {
    name: input.name,
    algorithm: input.algorithm,
    params_json: input.paramsJson,
    enabled: input.enabled ?? true,
    description: input.description,
  });

export const updatePolicyRaw = async (input: {
  policyId: string;
  algorithm: string;
  paramsJson: Record<string, unknown>;
  enabled?: boolean;
}): Promise<PolicyRaw> =>
  requestJson<PolicyRaw>(`/api/policies/${input.policyId}`, "PUT", {
    algorithm: input.algorithm,
    params_json: input.paramsJson,
    enabled: input.enabled ?? true,
  });

export const activatePolicyRaw = async (policyId: string, resetRuntimeState: boolean): Promise<void> => {
  await requestJson(`/api/policies/${policyId}/activate?reset_runtime_state=${resetRuntimeState ? "true" : "false"}`, "POST");
};

type PolicyWithIdentity = {
  id: string;
  name: string;
  enabled: boolean;
};

export const syncDashboardPolicy = async <
  TPolicy extends PolicyWithIdentity,
  TConfig,
>(input: {
  dashboardPolicyName: string;
  config: TConfig;
  resetRuntimeState: boolean;
  getActivePolicy: () => Promise<TPolicy | null>;
  listPolicies: () => Promise<TPolicy[]>;
  updatePolicy: (policyId: string, config: TConfig) => Promise<TPolicy>;
  createPolicy: (name: string, config: TConfig) => Promise<TPolicy>;
  activatePolicy: (policyId: string, resetRuntimeState: boolean) => Promise<void>;
}): Promise<TPolicy> => {
  const active = await input.getActivePolicy();

  let targetPolicy: TPolicy;
  if (active && active.enabled) {
    targetPolicy = await input.updatePolicy(active.id, input.config);
  } else {
    const candidates = await input.listPolicies();
    const existingManaged = candidates.find((item) => item.name === input.dashboardPolicyName);

    if (existingManaged) {
      targetPolicy = await input.updatePolicy(existingManaged.id, input.config);
    } else {
      targetPolicy = await input.createPolicy(input.dashboardPolicyName, input.config);
    }
  }

  await input.activatePolicy(targetPolicy.id, input.resetRuntimeState);
  const latest = await input.getActivePolicy();
  if (!latest) {
    throw new ApiError("Failed to read active policy after activation.", 500);
  }
  return latest;
};

export type SimulateHttpResult = {
  ok: boolean;
  status: number;
  body: unknown;
};

export type SimulateCallResult =
  | { kind: "http"; result: SimulateHttpResult }
  | { kind: "non_json" }
  | { kind: "timeout" }
  | { kind: "network_error"; message: string };

export const postSimulateRequest = async (payload: {
  clientId: string;
  runId?: string;
  timeoutMs?: number;
}): Promise<SimulateCallResult> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), payload.timeoutMs ?? REQUEST_TIMEOUT_MS);

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
      return { kind: "non_json" };
    }

    return {
      kind: "http",
      result: {
        ok: response.ok,
        status: response.status,
        body: responseBody,
      },
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { kind: "timeout" };
    }
    if (error instanceof Error) {
      return { kind: "network_error", message: error.message };
    }
    return { kind: "network_error", message: "Unknown request error." };
  } finally {
    clearTimeout(timeout);
  }
};
