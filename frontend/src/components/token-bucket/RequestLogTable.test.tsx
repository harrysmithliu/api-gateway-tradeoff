import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RequestLogTable } from "./RequestLogTable";
import type { TokenBucketEvent } from "../../types/tokenBucket";

const eventsFixture: TokenBucketEvent[] = [
  {
    id: "allow-1",
    ts: "2026-04-30T10:00:00.000Z",
    kind: "decision",
    decision: {
      requestId: "allow-request-id",
      ts: "2026-04-30T10:00:00.000Z",
      policyId: "p-1",
      algorithm: "token_bucket",
      allowed: true,
      reason: null,
      retryAfterMs: null,
      latencyMs: 4,
      remaining: 5,
      clientId: "client-a",
      runId: null,
      algorithmState: {
        count: 5,
        windowStartMs: 1714461600000,
        windowSizeSec: 0,
        stateSchemaVersion: 1,
        tokens: 5.7,
        capacity: 10,
        refillRatePerSec: 2,
        tokensPerRequest: 1,
        lastRefillMs: 1714461600000,
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
      algorithm: "token_bucket",
      allowed: false,
      reason: "rate_limit_exceeded",
      retryAfterMs: 320,
      latencyMs: 3,
      remaining: 0,
      clientId: "client-a",
      runId: null,
      algorithmState: {
        count: 0,
        windowStartMs: 1714461601000,
        windowSizeSec: 0,
        stateSchemaVersion: 1,
        tokens: 0.2,
        capacity: 10,
        refillRatePerSec: 2,
        tokensPerRequest: 1,
        lastRefillMs: 1714461601000,
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
