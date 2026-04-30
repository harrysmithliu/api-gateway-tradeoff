import { Suspense, lazy, useMemo, useState } from "react";

import { getFrontendApiBaseUrl } from "../api/leakyBucketApi";
import { KpiCards } from "../components/leaky-bucket/KpiCards";
import { RequestLogTable } from "../components/leaky-bucket/RequestLogTable";
import { SimulationControls } from "../components/leaky-bucket/SimulationControls";
import { useLeakyBucketSimulation } from "../hooks/useLeakyBucketSimulation";

const WaterLevelChart = lazy(async () =>
  import("../components/leaky-bucket/WaterLevelChart").then((module) => ({
    default: module.WaterLevelChart,
  })),
);

const OutcomeTimeline = lazy(async () =>
  import("../components/leaky-bucket/OutcomeTimeline").then((module) => ({
    default: module.OutcomeTimeline,
  })),
);

export function LeakyBucketDashboard() {
  const simulation = useLeakyBucketSimulation();
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

  const contractSummary = useMemo(() => {
    let missingBaselineState = 0;
    let missingSchemaVersion = 0;
    let retryAfterOnAllow = 0;

    simulation.events.forEach((event) => {
      event.issues.forEach((issue) => {
        if (issue.code === "missing_algorithm_state" || issue.code === "partial_algorithm_state") {
          missingBaselineState += 1;
        }
        if (issue.code === "missing_state_schema_version") {
          missingSchemaVersion += 1;
        }
        if (issue.code === "unexpected_retry_after_on_allow") {
          retryAfterOnAllow += 1;
        }
      });
    });

    return {
      missingBaselineState,
      missingSchemaVersion,
      retryAfterOnAllow,
    };
  }, [simulation.events]);

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header card">
        <p className="eyebrow">Leaky Bucket Dedicated Mode</p>
        <p className="meta">API Base URL: {getFrontendApiBaseUrl()}</p>
        <p className="meta">Status: {simulation.status}</p>
        <p className="meta">
          Active Policy:{" "}
          {simulation.activePolicy
            ? `${simulation.activePolicy.name} (capacity=${simulation.activePolicy.capacity}, leak=${simulation.activePolicy.leakRatePerSec}/s, water_per_request=${simulation.activePolicy.waterPerRequest})`
            : "not loaded"}
        </p>
        <p className={`meta sync-${simulation.policySyncStatus}`}>
          Policy Sync: {simulation.policySyncStatus}
          {simulation.policySyncMessage ? ` · ${simulation.policySyncMessage}` : ""}
        </p>
        <p className="meta">
          Leaky bucket semantics: water drains at a fixed leak rate; if burst arrivals fill backlog faster than leak, requests are rejected.
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
            <h2>Water Level Chart</h2>
            <p className="meta">Loading chart module...</p>
          </section>
        }
      >
        <WaterLevelChart events={simulation.events} />
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
        <h2>Contract Checks</h2>
        <p className="meta">Baseline state gaps: {contractSummary.missingBaselineState}</p>
        <p className="meta">Missing state_schema_version: {contractSummary.missingSchemaVersion}</p>
        <p className="meta">Allow decisions with retry_after_ms: {contractSummary.retryAfterOnAllow}</p>
      </section>

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
