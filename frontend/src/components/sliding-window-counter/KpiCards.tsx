import type { SlidingWindowCounterKpiSnapshot } from "../../types/slidingWindowCounter";

type KpiCardsProps = {
  kpi: SlidingWindowCounterKpiSnapshot;
};

const formatPercent = (value: number): string => `${(value * 100).toFixed(2)}%`;

const formatWindowRange = (startMs: number | null, endMs: number | null): string => {
  if (startMs === null || endMs === null) {
    return "-";
  }
  return `${new Date(startMs).toLocaleTimeString()} - ${new Date(endMs).toLocaleTimeString()}`;
};

export function KpiCards({ kpi }: KpiCardsProps) {
  return (
    <section className="kpi-grid">
      <article className="card kpi-card">
        <h3>Current SWC Window</h3>
        <p>{formatWindowRange(kpi.currentWindowStartMs, kpi.currentWindowEndMs)}</p>
      </article>
      <article className="card kpi-card">
        <h3>Estimated Count / Limit</h3>
        <p>{`${kpi.currentCount ?? 0} / ${kpi.currentLimit}`}</p>
      </article>
      <article className="card kpi-card">
        <h3>Remaining</h3>
        <p>{kpi.currentRemaining ?? "-"}</p>
      </article>
      <article className="card kpi-card">
        <h3>Allow Rate</h3>
        <p>{formatPercent(kpi.allowRate)}</p>
      </article>
      <article className="card kpi-card">
        <h3>Reject Rate</h3>
        <p>{formatPercent(kpi.rejectRate)}</p>
      </article>
      <article className="card kpi-card">
        <h3>Current RPS</h3>
        <p>{kpi.observedRps}</p>
      </article>
      <article className="card kpi-card">
        <h3>Last Retry After (ms)</h3>
        <p>{kpi.lastRetryAfterMs ?? "-"}</p>
      </article>
      <article className="card kpi-card">
        <h3>Prev Window Contribution</h3>
        <p>{kpi.previousContributionRatio === null ? "-" : formatPercent(kpi.previousContributionRatio)}</p>
      </article>
    </section>
  );
}
