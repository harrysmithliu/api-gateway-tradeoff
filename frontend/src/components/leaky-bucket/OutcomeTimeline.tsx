import { useEffect, useMemo, useRef } from "react";
import { ScatterChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { init, use, type EChartsType } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

import type { LeakyBucketEvent } from "../../types/leakyBucket";

use([ScatterChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

type OutcomeTimelineProps = {
  events: LeakyBucketEvent[];
};

type TooltipPoint = {
  ts: string;
  allowed: boolean;
  waterLevel: number | null;
  capacity: number | null;
  leakRatePerSec: number | null;
  waterPerRequest: number | null;
  remaining: number | null;
  retryAfterMs: number | null;
  latencyMs: number | null;
};

export function OutcomeTimeline({ events }: OutcomeTimelineProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);

  const chartData = useMemo(() => {
    const decisionEvents = events.filter((event) => event.kind === "decision" && event.decision);

    const allowSeries: Array<[number, number, TooltipPoint]> = [];
    const rejectSeries: Array<[number, number, TooltipPoint]> = [];

    decisionEvents.forEach((event) => {
      const decision = event.decision;
      if (!decision) {
        return;
      }

      const x = Date.parse(decision.ts);
      if (!Number.isFinite(x)) {
        return;
      }

      const point: TooltipPoint = {
        ts: decision.ts,
        allowed: decision.allowed,
        waterLevel: decision.algorithmState?.waterLevel ?? null,
        capacity: decision.algorithmState?.capacity ?? null,
        leakRatePerSec: decision.algorithmState?.leakRatePerSec ?? null,
        waterPerRequest: decision.algorithmState?.waterPerRequest ?? null,
        remaining: decision.remaining,
        retryAfterMs: decision.retryAfterMs,
        latencyMs: decision.latencyMs,
      };

      if (decision.allowed) {
        allowSeries.push([x, 0, point]);
      } else {
        rejectSeries.push([x, 0, point]);
      }
    });

    return {
      allowSeries,
      rejectSeries,
    };
  }, [events]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const chart = init(containerRef.current);
    chartRef.current = chart;

    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!chartRef.current) {
      return;
    }

    chartRef.current.setOption({
      animation: false,
      legend: {
        top: 6,
      },
      tooltip: {
        trigger: "item",
        formatter: (params: { data?: [number, number, TooltipPoint] }) => {
          const point = params.data?.[2];
          if (!point) {
            return "No data";
          }
          return [
            `ts: ${new Date(point.ts).toLocaleTimeString()}`,
            `allowed: ${point.allowed}`,
            `water_level: ${point.waterLevel === null ? "-" : point.waterLevel.toFixed(3)}`,
            `capacity: ${point.capacity ?? "-"}`,
            `leak_rate_per_sec: ${point.leakRatePerSec ?? "-"}`,
            `water_per_request: ${point.waterPerRequest ?? "-"}`,
            `remaining_headroom: ${point.remaining ?? "-"}`,
            `retry_after_ms: ${point.retryAfterMs ?? "-"}`,
            `latency_ms: ${point.latencyMs ?? "-"}`,
          ].join("<br/>");
        },
      },
      grid: {
        left: 18,
        right: 18,
        top: 46,
        bottom: 24,
        containLabel: true,
      },
      xAxis: {
        type: "time",
      },
      yAxis: {
        type: "value",
        min: -1,
        max: 1,
        axisLabel: { show: false },
        splitLine: { show: false },
      },
      series: [
        {
          name: "Allow",
          type: "scatter",
          data: chartData.allowSeries,
          symbolSize: 8,
          itemStyle: {
            color: "#16a34a",
          },
        },
        {
          name: "Reject",
          type: "scatter",
          data: chartData.rejectSeries,
          symbolSize: 8,
          itemStyle: {
            color: "#dc2626",
          },
        },
      ],
    });
  }, [chartData]);

  return (
    <section className="card panel">
      <h2>Request Outcome Timeline</h2>
      <p className="meta">Retry-after indicates how long to wait until enough water leaks out for the next request cost.</p>
      <div className="chart-surface" ref={containerRef} aria-label="Leaky bucket outcome timeline chart" />
    </section>
  );
}
