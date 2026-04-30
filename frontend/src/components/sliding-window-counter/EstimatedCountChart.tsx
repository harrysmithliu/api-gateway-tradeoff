import { useEffect, useMemo, useRef } from "react";
import { LineChart, ScatterChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { init, use, type EChartsType } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

import type { SlidingWindowCounterEvent } from "../../types/slidingWindowCounter";

use([LineChart, ScatterChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

type EstimatedCountChartProps = {
  events: SlidingWindowCounterEvent[];
  limit: number;
};

type TooltipPoint = {
  ts: string;
  estimatedCount: number;
  currentWindowCount: number;
  previousWindowCount: number;
  previousWindowWeight: number;
  remaining: number | null;
  allowed: boolean;
};

export function EstimatedCountChart({ events, limit }: EstimatedCountChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);

  const chartData = useMemo(() => {
    const points = events
      .filter((event) => event.kind === "decision" && event.decision?.algorithmState)
      .map((event) => {
        const decision = event.decision;
        if (!decision || !decision.algorithmState) {
          return null;
        }

        const tsMs = Date.parse(event.ts);
        if (!Number.isFinite(tsMs)) {
          return null;
        }

        return {
          ts: event.ts,
          tsMs,
          estimatedCount: decision.algorithmState.estimatedCount,
          currentWindowCount: decision.algorithmState.currentWindowCount,
          previousWindowCount: decision.algorithmState.previousWindowCount,
          previousWindowWeight: decision.algorithmState.previousWindowWeight,
          remaining: decision.remaining,
          allowed: decision.allowed,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    const estimatedSeries: Array<[number, number, TooltipPoint]> = points.map((item) => [
      item.tsMs,
      item.estimatedCount,
      item,
    ]);

    const limitSeries = points.map((item) => [item.tsMs, limit]);
    const rejectPoints = points
      .filter((item) => !item.allowed)
      .map((item) => [item.tsMs, item.estimatedCount, item] as [number, number, TooltipPoint]);

    return {
      estimatedSeries,
      limitSeries,
      rejectPoints,
    };
  }, [events, limit]);

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
        formatter: (params: { seriesName?: string; data?: [number, number, TooltipPoint] }) => {
          const point = params.data?.[2];
          if (!point) {
            return "No data";
          }
          return [
            `${params.seriesName ?? "Point"}`,
            `ts: ${new Date(point.ts).toLocaleTimeString()}`,
            `estimated_count: ${point.estimatedCount.toFixed(3)}`,
            `current_window_count: ${point.currentWindowCount}`,
            `previous_window_count: ${point.previousWindowCount}`,
            `previous_window_weight: ${point.previousWindowWeight.toFixed(3)}`,
            `remaining: ${point.remaining ?? "-"}`,
            `allowed: ${point.allowed}`,
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
        min: 0,
      },
      series: [
        {
          name: "Estimated Count",
          type: "line",
          data: chartData.estimatedSeries,
          showSymbol: false,
          smooth: false,
          lineStyle: {
            width: 2,
            color: "#0f766e",
          },
        },
        {
          name: "Limit",
          type: "line",
          data: chartData.limitSeries,
          showSymbol: false,
          lineStyle: {
            width: 2,
            type: "solid",
            color: "#7c3aed",
          },
        },
        {
          name: "Reject",
          type: "scatter",
          data: chartData.rejectPoints,
          symbolSize: 7,
          itemStyle: {
            color: "#dc2626",
          },
          z: 3,
        },
      ],
    });
  }, [chartData]);

  return (
    <section className="card panel">
      <h2>Estimated Count Chart</h2>
      <p className="meta">Primary SWC signal: estimated_count compared against limit over time.</p>
      <div className="chart-surface" ref={containerRef} aria-label="SWC estimated count chart" />
    </section>
  );
}
