import type { LeakyBucketKpiSnapshot } from "../../types/leakyBucket";

type KpiCardsProps = {
  kpi: LeakyBucketKpiSnapshot;
};

const formatPercent = (value: number): string => `${(value * 100).toFixed(2)}%`;

export function KpiCards({ kpi }: KpiCardsProps) {
  return (
    <section className="kpi-grid">
      <article className="card kpi-card">
        <h3>Current Water Level</h3>
        <p>{kpi.currentWaterLevel === null ? "-" : kpi.currentWaterLevel.toFixed(3)}</p>
      </article>
      <article className="card kpi-card">
        <h3>Capacity</h3>
        <p>{kpi.currentCapacity}</p>
      </article>
      <article className="card kpi-card">
        <h3>Leak Rate / sec</h3>
        <p>{kpi.currentLeakRatePerSec.toFixed(3)}</p>
      </article>
      <article className="card kpi-card">
        <h3>Water / Request</h3>
        <p>{kpi.currentWaterPerRequest}</p>
      </article>
      <article className="card kpi-card">
        <h3>Remaining Headroom</h3>
        <p>{kpi.currentHeadroom ?? "-"}</p>
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
    </section>
  );
}
