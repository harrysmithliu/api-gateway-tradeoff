import type { TokenBucketKpiSnapshot } from "../../types/tokenBucket";

type KpiCardsProps = {
  kpi: TokenBucketKpiSnapshot;
};

const formatPercent = (value: number): string => `${(value * 100).toFixed(2)}%`;

export function KpiCards({ kpi }: KpiCardsProps) {
  return (
    <section className="kpi-grid">
      <article className="card kpi-card">
        <h3>Current Tokens</h3>
        <p>{kpi.currentTokens === null ? "-" : kpi.currentTokens.toFixed(3)}</p>
      </article>
      <article className="card kpi-card">
        <h3>Capacity</h3>
        <p>{kpi.currentCapacity}</p>
      </article>
      <article className="card kpi-card">
        <h3>Refill Rate / sec</h3>
        <p>{kpi.currentRefillRatePerSec.toFixed(3)}</p>
      </article>
      <article className="card kpi-card">
        <h3>Tokens / Request</h3>
        <p>{kpi.currentTokensPerRequest}</p>
      </article>
      <article className="card kpi-card">
        <h3>Request Budget</h3>
        <p>{kpi.currentRequestBudget ?? "-"}</p>
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
