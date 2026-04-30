import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RequestLogTable } from "./RequestLogTable";
import type { SlidingWindowCounterEvent } from "../../types/slidingWindowCounter";

const eventsFixture: SlidingWindowCounterEvent[] = [
  {
    id: "allow-1",
    ts: "2026-04-30T10:00:00.000Z",
    kind: "decision",
    decision: {
      requestId: "allow-request-id",
      ts: "2026-04-30T10:00:00.000Z",
      policyId: "p-1",
      algorithm: "sliding_window_counter",
      allowed: true,
      reason: null,
      retryAfterMs: null,
      latencyMs: 4,
      remaining: 3,
      clientId: "client-a",
      runId: null,
      algorithmState: {
        count: 7.2,
        windowStartMs: 1714461600000,
        windowSizeSec: 10,
        currentWindowCount: 6,
        previousWindowCount: 3,
        previousWindowWeight: 0.4,
        estimatedCount: 7.2,
        stateSchemaVersion: 1,
      },
    },
    issues: [],
  },
  {
    id: "reject-1",
    ts: "2026-04-30T10:00:01.000Z",
    kind: "decision",
    decision: {
      requestId: "reject-request-id",
      ts: "2026-04-30T10:00:01.000Z",
      policyId: "p-1",
      algorithm: "sliding_window_counter",
      allowed: false,
      reason: "rate_limit_exceeded",
      retryAfterMs: 320,
      latencyMs: 3,
      remaining: 0,
      clientId: "client-a",
      runId: null,
      algorithmState: {
        count: 10.4,
        windowStartMs: 1714461600000,
        windowSizeSec: 10,
        currentWindowCount: 9,
        previousWindowCount: 2,
        previousWindowWeight: 0.7,
        estimatedCount: 10.4,
        stateSchemaVersion: 1,
      },
    },
    issues: [],
  },
];

describe("RequestLogTable", () => {
  it("filters rejected rows when rejected-only is enabled", () => {
    const onRejectedOnlyChange = vi.fn();
    const onAutoScrollChange = vi.fn();

    const { rerender } = render(
      <RequestLogTable
        events={eventsFixture}
        rejectedOnly={false}
        autoScroll={true}
        onRejectedOnlyChange={onRejectedOnlyChange}
        onAutoScrollChange={onAutoScrollChange}
      />,
    );

    expect(screen.getByText("allow-re")).toBeInTheDocument();
    expect(screen.getByText("reject-r")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Rejected only"));
    expect(onRejectedOnlyChange).toHaveBeenCalledWith(true);

    rerender(
      <RequestLogTable
        events={eventsFixture}
        rejectedOnly={true}
        autoScroll={true}
        onRejectedOnlyChange={onRejectedOnlyChange}
        onAutoScrollChange={onAutoScrollChange}
      />,
    );

    expect(screen.queryByText("allow-re")).not.toBeInTheDocument();
    expect(screen.getByText("reject-r")).toBeInTheDocument();
  });
});
