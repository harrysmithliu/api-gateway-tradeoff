import { useEffect, useMemo, useRef } from "react";

import type { SlidingLogEvent } from "../../types/slidingLog";

type RequestLogTableProps = {
  events: SlidingLogEvent[];
  rejectedOnly: boolean;
  autoScroll: boolean;
  onRejectedOnlyChange: (next: boolean) => void;
  onAutoScrollChange: (next: boolean) => void;
};

export function RequestLogTable({
  events,
  rejectedOnly,
  autoScroll,
  onRejectedOnlyChange,
  onAutoScrollChange,
}: RequestLogTableProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const rows = useMemo(() => {
    if (!rejectedOnly) {
      return events;
    }
    return events.filter((event) => {
      if (event.kind === "synthetic_error") {
        return true;
      }
      return event.decision?.allowed === false;
    });
  }, [events, rejectedOnly]);

  useEffect(() => {
    if (!autoScroll || !containerRef.current) {
      return;
    }
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [rows, autoScroll]);

  return (
    <section className="card panel">
      <div className="panel-header">
        <h2>Request Log Table</h2>
        <div className="toggles-row">
          <label className="inline-toggle">
            <input
              type="checkbox"
              checked={rejectedOnly}
              onChange={(event) => onRejectedOnlyChange(event.target.checked)}
            />
            Rejected only
          </label>
          <label className="inline-toggle">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(event) => onAutoScrollChange(event.target.checked)}
            />
            Auto-scroll
          </label>
        </div>
      </div>

      <div className="table-wrap" ref={containerRef}>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Request ID</th>
              <th>Client ID</th>
              <th>Result</th>
              <th>Count</th>
              <th>Remaining</th>
              <th>Retry After (ms)</th>
              <th>Latency (ms)</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((event) => {
              if (event.kind === "synthetic_error" || !event.decision) {
                return (
                  <tr key={event.id} className="log-error">
                    <td>{new Date(event.ts).toLocaleTimeString()}</td>
                    <td>-</td>
                    <td>-</td>
                    <td>ERROR</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td>{event.issues.map((issue) => issue.message).join(" | ") || "Synthetic error"}</td>
                  </tr>
                );
              }

              const decision = event.decision;
              const resultClass = decision.allowed ? "log-allow" : "log-reject";

              return (
                <tr key={event.id} className={resultClass}>
                  <td>{new Date(event.ts).toLocaleTimeString()}</td>
                  <td>{decision.requestId.slice(0, 8)}</td>
                  <td>{decision.clientId}</td>
                  <td>{decision.allowed ? "ALLOW" : "REJECT"}</td>
                  <td>{decision.algorithmState?.count ?? "-"}</td>
                  <td>{decision.remaining ?? "-"}</td>
                  <td>{decision.retryAfterMs ?? "-"}</td>
                  <td>{decision.latencyMs}</td>
                  <td>{decision.reason ?? "-"}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="empty-cell">
                  No events.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
