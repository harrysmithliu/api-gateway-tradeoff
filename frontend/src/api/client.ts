const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

type HttpMethod = "GET" | "POST" | "PUT";
type RequestOptions = {
  allowedStatuses?: number[];
};

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export const getApiBaseUrl = (): string => API_BASE_URL;

export const requestJson = async <TResponse>(
  path: string,
  method: HttpMethod = "GET",
  body?: unknown,
  options?: RequestOptions,
): Promise<TResponse> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const statusAllowed = options?.allowedStatuses?.includes(response.status) ?? false;
  if (!response.ok && !statusAllowed) {
    let detail = `Request failed with status ${response.status}`;
    try {
      const errorJson = (await response.json()) as { detail?: string };
      if (typeof errorJson.detail === "string") {
        detail = errorJson.detail;
      }
    } catch {
      // Keep default detail when response is not JSON.
    }
    throw new ApiError(detail, response.status);
  }

  return (await response.json()) as TResponse;
};
