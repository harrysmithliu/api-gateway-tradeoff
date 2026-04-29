import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Dashboard } from "./Dashboard";
import type { ExperimentRun, Policy, SimulateDecision } from "../types";
import * as gateway from "../api/gateway";

vi.mock("../components/ComparisonChart", () => ({
  ComparisonChart: ({ points }: { points: Array<unknown> }) => (
    <div data-testid="chart-points">points:{points.length}</div>
  ),
}));

vi.mock("../api/gateway", () => ({
  activatePolicy: vi.fn(),
  completeRun: vi.fn(),
  createPolicy: vi.fn(),
  createRun: vi.fn(),
  getActivePolicy: vi.fn(),
  getLogs: vi.fn(),
  getMetricsSummary: vi.fn(),
  getMetricsTimeseries: vi.fn(),
  listPolicies: vi.fn(),
  listRuns: vi.fn(),
  simulateBurst: vi.fn(),
  simulateOneRequest: vi.fn(),
  updatePolicy: vi.fn(),
}));

const fixedPolicy: Policy = {
  id: "policy-fixed",
  name: "fixed-default",
  algorithm: "fixed_window",
  params_json: { window_size_sec: 10, limit: 100 },
  enabled: true,
  version: 1,
  description: "fixed",
  created_at: "2026-04-29T00:00:00Z",
  updated_at: "2026-04-29T00:00:00Z",
};

const tokenPolicy: Policy = {
  id: "policy-token",
  name: "token-default",
  algorithm: "token_bucket",
  params_json: { capacity: 200, refill_rate_per_sec: 80, tokens_per_request: 2 },
  enabled: true,
  version: 1,
  description: "token",
  created_at: "2026-04-29T00:00:00Z",
  updated_at: "2026-04-29T00:00:00Z",
};

const runFixture: ExperimentRun = {
  id: "run-1",
  name: "ui-run-test",
  policy_id: fixedPolicy.id,
  scenario_json: {},
  started_at: "2026-04-29T00:00:00Z",
  ended_at: null,
  status: "running",
};

const completedRunFixture: ExperimentRun = {
  ...runFixture,
  ended_at: "2026-04-29T00:00:01Z",
  status: "completed",
};

const decisionFixture: SimulateDecision = {
  request_id: "12345678-1234-1234-1234-123456789abc",
  ts: "2026-04-29T00:00:00Z",
  policy_id: fixedPolicy.id,
  algorithm: "fixed_window",
  allowed: false,
  reason: "rate_limit_exceeded",
  retry_after_ms: 320,
  latency_ms: 4,
  remaining: 0,
  run_id: runFixture.id,
  client_id: "client-a",
  algorithm_state: null,
};

const mockedGateway = vi.mocked(gateway);

beforeEach(() => {
  vi.clearAllMocks();

  mockedGateway.listPolicies.mockResolvedValue([fixedPolicy, tokenPolicy]);
  mockedGateway.getActivePolicy.mockResolvedValue(fixedPolicy);
  mockedGateway.listRuns.mockResolvedValue([]);

  mockedGateway.getMetricsSummary.mockResolvedValue({
    total: 40,
    allowed: 30,
    rejected: 10,
    accept_rate: 0.75,
    reject_rate: 0.25,
    qps: 5,
    p50: 1.1,
    p95: 5.2,
    p99: 9.5,
    peak_qps: 12,
  });

  mockedGateway.getMetricsTimeseries.mockResolvedValue([
    {
      ts: 1714400000,
      qps: 5,
      allowed: 3,
      rejected: 2,
      reject_rate: 0.4,
      p99_ms: 9,
      peak_delta: 1,
    },
  ]);

  mockedGateway.getLogs.mockResolvedValue({
    items: [],
    next_cursor: 0,
    limit: 200,
    run_id: null,
  });

  mockedGateway.createRun.mockResolvedValue(runFixture);
  mockedGateway.completeRun.mockResolvedValue(completedRunFixture);
  mockedGateway.simulateOneRequest.mockResolvedValue(decisionFixture);
  mockedGateway.simulateBurst.mockResolvedValue({
    total: 1,
    allowed: 0,
    rejected: 1,
    decisions: [decisionFixture],
  });
});

describe("Dashboard sanity checks", () => {
  it("updates parameter fields when policy changes", async () => {
    render(<Dashboard />);

    await screen.findByDisplayValue("fixed-default");

    const policySelect = screen.getByLabelText("Policy") as HTMLSelectElement;
    fireEvent.change(policySelect, { target: { value: tokenPolicy.id } });

    expect(await screen.findByLabelText("Capacity")).toHaveValue(200);
    expect(screen.getByLabelText("Refill Rate Per Sec")).toHaveValue(80);
    expect(screen.queryByLabelText("Window Size Sec")).not.toBeInTheDocument();
  });

  it("updates logs and chart during a simulation run", async () => {
    mockedGateway.listRuns
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([runFixture])
      .mockResolvedValue([{ ...completedRunFixture }]);

    mockedGateway.getLogs.mockImplementation(async (cursor: number) => {
      if (cursor === 0) {
        return {
          items: [decisionFixture],
          next_cursor: 1,
          limit: 200,
          run_id: runFixture.id,
        };
      }
      return {
        items: [],
        next_cursor: cursor,
        limit: 200,
        run_id: runFixture.id,
      };
    });

    render(<Dashboard />);

    await screen.findByDisplayValue("fixed-default");

    fireEvent.change(screen.getByLabelText("Rounds"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Requests / Round"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Round Interval (ms)"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Concurrency"), { target: { value: "1" } });

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => {
      expect(mockedGateway.createRun).toHaveBeenCalledTimes(1);
      expect(mockedGateway.simulateOneRequest).toHaveBeenCalledTimes(1);
      expect(mockedGateway.completeRun).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText(/Simulation completed: 1\/1 requests\./)).toBeInTheDocument();
    expect(await screen.findByText(/Current run: ui-run-test/)).toBeInTheDocument();
    expect(await screen.findByText("client-a")).toBeInTheDocument();
    expect(screen.getByTestId("chart-points")).toHaveTextContent("points:1");
  });

  it("renders reject rate and P99 KPI values", async () => {
    render(<Dashboard />);

    expect(await screen.findByText("25.00%")).toBeInTheDocument();
    expect(screen.getByText("1.10 / 5.20 / 9.50")).toBeInTheDocument();
  });
});
