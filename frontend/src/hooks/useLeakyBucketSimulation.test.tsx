import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLeakyBucketSimulation } from "./useLeakyBucketSimulation";

vi.mock("../api/leakyBucketApi", () => ({
  ApiError: class ApiError extends Error {
    status: number;

    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  fetchActiveLeakyBucketPolicy: vi.fn(),
  simulateLeakyBucketRequest: vi.fn(),
  syncLeakyBucketPolicyConfig: vi.fn(),
}));

import {
  fetchActiveLeakyBucketPolicy,
  simulateLeakyBucketRequest,
  syncLeakyBucketPolicyConfig,
} from "../api/leakyBucketApi";

const mockedSimulate = vi.mocked(simulateLeakyBucketRequest);
const mockedFetchActivePolicy = vi.mocked(fetchActiveLeakyBucketPolicy);
const mockedSyncPolicy = vi.mocked(syncLeakyBucketPolicyConfig);

describe("useLeakyBucketSimulation", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();

    mockedFetchActivePolicy.mockResolvedValue({
      id: "policy-leaky-bucket",
      name: "leaky-bucket-dashboard",
      algorithm: "leaky_bucket",
      capacity: 20,
      leakRatePerSec: 2,
      waterPerRequest: 1,
      enabled: true,
      version: 1,
      description: null,
      updatedAt: new Date().toISOString(),
    });

    mockedSyncPolicy.mockResolvedValue({
      id: "policy-leaky-bucket",
      name: "leaky-bucket-dashboard",
      algorithm: "leaky_bucket",
      capacity: 20,
      leakRatePerSec: 2,
      waterPerRequest: 1,
      enabled: true,
      version: 2,
      description: null,
      updatedAt: new Date().toISOString(),
    });

    let seq = 0;
    mockedSimulate.mockImplementation(async () => {
      seq += 1;
      const ts = new Date(Date.now()).toISOString();
      return {
        event: {
          id: `event-${seq}`,
          ts,
          kind: "decision",
          issues: [],
          decision: {
            requestId: `req-${seq}`,
            ts,
            policyId: "policy-1",
            algorithm: "leaky_bucket",
            allowed: seq % 4 !== 0,
            reason: seq % 4 === 0 ? "rate_limit_exceeded" : null,
            retryAfterMs: seq % 4 === 0 ? 250 : null,
            latencyMs: 3,
            remaining: Math.max(0, 8 - seq),
            clientId: "client-a",
            runId: null,
            algorithmState: {
              count: Math.max(0, 8 - seq),
              windowStartMs: Date.now(),
              windowSizeSec: 0,
              stateSchemaVersion: 1,
              waterLevel: Math.max(0, 8 - seq) + 0.4,
              capacity: 20,
              leakRatePerSec: 2,
              waterPerRequest: 1,
              lastLeakMs: Date.now(),
            },
          },
        },
      };
    });
  });

  it("dispatches requests and updates leaky-bucket KPI snapshot", async () => {
    const { result } = renderHook(() => useLeakyBucketSimulation());

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

    await waitFor(
      () => {
        expect(result.current.status).toBe("running");
      },
      { timeout: 1500 },
    );

    await waitFor(
      () => {
        expect(result.current.status).toBe("idle");
      },
      { timeout: 5000 },
    );

    await waitFor(() => {
      expect(result.current.events.length).toBeGreaterThan(0);
    });

    expect(result.current.kpi.total).toBe(result.current.events.length);
    expect(mockedSyncPolicy).toHaveBeenCalledTimes(1);

    const latestDecisionEvent = [...result.current.events]
      .reverse()
      .find((event) => event.kind === "decision" && event.decision);

    expect(latestDecisionEvent?.decision?.algorithmState?.waterLevel ?? null).toBe(result.current.kpi.currentWaterLevel);
    expect(result.current.kpi.currentCapacity).toBeGreaterThan(0);
  });
});
