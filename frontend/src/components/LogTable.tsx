import { useEffect, useRef } from "react";

import { ALGORITHM_LABELS, type Policy, type SimulateDecision } from "../types";

type LogTableProps = {
  logs: SimulateDecision[];
  rejectedOnly: boolean;
  policiesById: Record<string, Policy>;
  onRejectedOnlyChange: (next: boolean) => void;
  onClear: () => void;
};

export function LogTable({
  logs,
  rejectedOnly,
  policiesById,
  onRejectedOnlyChange,
  onClear,
}: LogTableProps) {
  const tableContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!tableContainerRef.current) {
      return;
    }
    tableContainerRef.current.scrollTop = tableContainerRef.current.scrollHeight;
  }, [logs]);

  return (
    <section className="card panel">
      <div className="panel-header">
        <h2>Logs</h2>
        <div className="action-row inline">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={rejectedOnly}
              onChange={(event) => onRejectedOnlyChange(event.target.checked)}
            />
            Rejected Only
          </label>
          <button type="button" className="ghost-button" onClick={onClear}>
            Clear Table View
          </button>
        </div>
      </div>

      <div className="table-wrap" ref={tableContainerRef}>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Request ID</th>
              <th>Client ID</th>
              <th>Policy</th>
              <th>Algorithm</th>
              <th>Allowed</th>
              <th>Reason</th>
              <th>Retry After (ms)</th>
              <th>Latency (ms)</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.request_id} className={log.allowed ? "allowed" : "rejected"}>
                <td>{new Date(log.ts).toLocaleTimeString()}</td>
                <td>{log.request_id.slice(0, 8)}</td>
                <td>{log.client_id}</td>
                <td>{policiesById[log.policy_id]?.name ?? log.policy_id.slice(0, 8)}</td>
                <td>{ALGORITHM_LABELS[log.algorithm]}</td>
                <td>{log.allowed ? "Yes" : "No"}</td>
                <td>{log.reason ?? "-"}</td>
                <td>{log.retry_after_ms ?? "-"}</td>
                <td>{log.latency_ms}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
