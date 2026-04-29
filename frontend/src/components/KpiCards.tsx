import type { MetricsSummary } from "../types";

type KpiCardsProps = {
  summary: MetricsSummary | null;
};

const formatPercent = (value: number): string => `${(value * 100).toFixed(2)}%`;

export function KpiCards({ summary }: KpiCardsProps) {
  const data =
    summary ??
    ({
      total: 0,
      allowed: 0,
      rejected: 0,
      reject_rate: 0,
      qps: 0,
      peak_qps: 0,
      p50: 0,
      p95: 0,
      p99: 0,
    } as const);

  return (
    <section className="kpi-grid">
      <article className="card kpi-card">
        <h3>Total Requests</h3>
        <p>{data.total}</p>
      </article>
      <article className="card kpi-card">
        <h3>Allowed</h3>
        <p>{data.allowed}</p>
      </article>
      <article className="card kpi-card">
        <h3>Rejected</h3>
        <p>{data.rejected}</p>
      </article>
      <article className="card kpi-card">
        <h3>Reject Rate</h3>
        <p>{formatPercent(data.reject_rate)}</p>
      </article>
      <article className="card kpi-card">
        <h3>Current QPS</h3>
        <p>{data.qps.toFixed(2)}</p>
      </article>
      <article className="card kpi-card">
        <h3>Peak QPS</h3>
        <p>{data.peak_qps.toFixed(2)}</p>
      </article>
      <article className="card kpi-card">
        <h3>P50 / P95 / P99 (ms)</h3>
        <p>
          {data.p50.toFixed(2)} / {data.p95.toFixed(2)} / {data.p99.toFixed(2)}
        </p>
      </article>
    </section>
  );
}
