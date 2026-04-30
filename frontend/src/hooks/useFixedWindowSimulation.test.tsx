import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useFixedWindowSimulation } from "./useFixedWindowSimulation";

vi.mock("../api/fixedWindowApi", () => ({
  ApiError: class ApiError extends Error {
    status: number;

    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  fetchActiveFixedWindowPolicy: vi.fn(),
  simulateFixedWindowRequest: vi.fn(),
  syncFixedWindowPolicyConfig: vi.fn(),
}));

import {
  fetchActiveFixedWindowPolicy,
  simulateFixedWindowRequest,
  syncFixedWindowPolicyConfig,
} from "../api/fixedWindowApi";

const mockedSimulate = vi.mocked(simulateFixedWindowRequest);
const mockedFetchActivePolicy = vi.mocked(fetchActiveFixedWindowPolicy);
const mockedSyncPolicy = vi.mocked(syncFixedWindowPolicyConfig);

describe("useFixedWindowSimulation", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();

    mockedFetchActivePolicy.mockResolvedValue({
      id: "policy-fixed-window",
      name: "fixed-window-dashboard",
      algorithm: "fixed_window",
      limit: 10,
      windowSizeSec: 10,
      enabled: true,
      version: 1,
      description: null,
      updatedAt: new Date().toISOString(),
    });

    mockedSyncPolicy.mockResolvedValue({
      id: "policy-fixed-window",
      name: "fixed-window-dashboard",
      algorithm: "fixed_window",
      limit: 10,
      windowSizeSec: 10,
      enabled: true,
      version: 2,
      description: null,
      updatedAt: new Date().toISOString(),
    });

    let count = 0;
    mockedSimulate.mockImplementation(async () => {
      count += 1;
      const ts = new Date(Date.now()).toISOString();
      return {
        event: {
          id: `event-${count}`,
          ts,
          kind: "decision",
          issues: [],
          decision: {
            requestId: `req-${count}`,
            ts,
            policyId: "policy-1",
            algorithm: "fixed_window",
            allowed: count % 3 !== 0,
            reason: count % 3 === 0 ? "rate_limit_exceeded" : null,
            retryAfterMs: count % 3 === 0 ? 250 : null,
            latencyMs: 3,
            remaining: Math.max(0, 10 - count),
            clientId: "client-a",
            runId: null,
            algorithmState: {
              count,
              windowStartMs: 1714478400000,
              windowSizeSec: 10,
            },
          },
        },
      };
    });
  });

  it("dispatches requests and updates KPI snapshot consistently", async () => {
    const { result } = renderHook(() => useFixedWindowSimulation());

    act(() => {
      result.current.updateConfig({
        rps: 8,
        durationSec: 1,
        concurrency: 2,
      });
    });

    await waitFor(() => {
      expect(result.current.config.durationSec).toBe(1);
    });

    act(() => {
      result.current.start();
    });

    await waitFor(() => {
      expect(result.current.status).toBe("running");
    }, { timeout: 1500 });

    await waitFor(() => {
      expect(result.current.status).toBe("idle");
    }, { timeout: 5000 });

    await waitFor(() => {
      expect(result.current.events.length).toBeGreaterThan(0);
    });

    expect(result.current.kpi.total).toBe(result.current.events.length);
    expect(mockedSyncPolicy).toHaveBeenCalledTimes(1);

    const latestDecisionEvent = [...result.current.events]
      .reverse()
      .find((event) => event.kind === "decision" && event.decision);

    expect(latestDecisionEvent?.decision?.algorithmState?.count ?? null).toBe(result.current.kpi.currentCount);
    expect(result.current.kpi.currentLimit).toBe(result.current.config.limit);
  });
});
