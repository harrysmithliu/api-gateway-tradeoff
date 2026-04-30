import { Suspense, lazy, useMemo, useState } from "react";

import { getFrontendApiBaseUrl } from "../api/fixedWindowApi";
import { KpiCards } from "../components/fixed-window/KpiCards";
import { RequestLogTable } from "../components/fixed-window/RequestLogTable";
import { SimulationControls } from "../components/fixed-window/SimulationControls";
import { useFixedWindowSimulation } from "../hooks/useFixedWindowSimulation";

const WindowOccupancyChart = lazy(async () =>
  import("../components/fixed-window/WindowOccupancyChart").then((module) => ({
    default: module.WindowOccupancyChart,
  })),
);

const OutcomeTimeline = lazy(async () =>
  import("../components/fixed-window/OutcomeTimeline").then((module) => ({
    default: module.OutcomeTimeline,
  })),
);

export function FixedWindowDashboard() {
  const simulation = useFixedWindowSimulation();
  const [rejectedOnly, setRejectedOnly] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  const diagnostics = useMemo(() => {
    const messages: Array<{ severity: string; message: string; at: string }> = [];
    simulation.events.forEach((event) => {
      event.issues.forEach((issue) => {
        messages.push({
          severity: issue.severity,
          message: issue.message,
          at: event.ts,
        });
      });
    });
    return messages.slice(-8).reverse();
  }, [simulation.events]);

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header card">
        <p className="eyebrow">Fixed Window Dedicated Mode</p>
        <h1>Fixed Window Rate Limiter Visualization</h1>
        <p className="meta">API Base URL: {getFrontendApiBaseUrl()}</p>
        <p className="meta">Status: {simulation.status}</p>
        <p className="meta">
          Active Policy:{" "}
          {simulation.activePolicy
            ? `${simulation.activePolicy.name} (limit=${simulation.activePolicy.limit}, window=${simulation.activePolicy.windowSizeSec}s)`
            : "not loaded"}
        </p>
        <p className={`meta sync-${simulation.policySyncStatus}`}>
          Policy Sync: {simulation.policySyncStatus}
          {simulation.policySyncMessage ? ` · ${simulation.policySyncMessage}` : ""}
        </p>
        <div className="button-row">
          <button type="button" className="ghost" onClick={() => void simulation.reloadActivePolicy()}>
            Reload Active Policy
          </button>
        </div>
      </header>

      <SimulationControls
        config={simulation.config}
        status={simulation.status}
        onUpdateConfig={simulation.updateConfig}
        onStart={simulation.start}
        onPause={simulation.pause}
        onResume={simulation.resume}
        onStop={simulation.stop}
        onResetView={simulation.resetView}
      />

      <KpiCards kpi={simulation.kpi} />

      <Suspense
        fallback={
          <section className="card panel">
            <h2>Window Occupancy Chart</h2>
            <p className="meta">Loading chart module...</p>
          </section>
        }
      >
        <WindowOccupancyChart
          events={simulation.events}
          windowBoundaries={simulation.windowBoundaries}
          limit={simulation.config.limit}
        />
      </Suspense>

      <Suspense
        fallback={
          <section className="card panel">
            <h2>Request Outcome Timeline</h2>
            <p className="meta">Loading chart module...</p>
          </section>
        }
      >
        <OutcomeTimeline events={simulation.events} />
      </Suspense>

      <RequestLogTable
        events={simulation.events}
        rejectedOnly={rejectedOnly}
        autoScroll={autoScroll}
        onRejectedOnlyChange={setRejectedOnly}
        onAutoScrollChange={setAutoScroll}
      />

      <section className="card panel">
        <h2>Diagnostics</h2>
        {diagnostics.length === 0 && <p>No warnings or errors.</p>}
        {diagnostics.length > 0 && (
          <ul className="diagnostics-list">
            {diagnostics.map((item, index) => (
              <li key={`${item.at}-${index}`} className={`diag-${item.severity}`}>
                [{new Date(item.at).toLocaleTimeString()}] {item.message}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
