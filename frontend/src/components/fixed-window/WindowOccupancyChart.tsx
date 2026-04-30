import { useEffect, useMemo, useRef } from "react";
import { LineChart, ScatterChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { init, use, type EChartsType } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

import type { FixedWindowBoundary, FixedWindowEvent } from "../../types/fixedWindow";

use([LineChart, ScatterChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

type WindowOccupancyChartProps = {
  events: FixedWindowEvent[];
  windowBoundaries: FixedWindowBoundary[];
  limit: number;
};

export function WindowOccupancyChart({ events, windowBoundaries, limit }: WindowOccupancyChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);

  const chartData = useMemo(() => {
    const decisions = events
      .filter((event) => event.kind === "decision" && event.decision?.algorithmState)
      .map((event) => ({
        tsMs: Date.parse(event.ts),
        count: event.decision?.algorithmState?.count ?? 0,
        allowed: event.decision?.allowed ?? false,
      }))
      .filter((item) => Number.isFinite(item.tsMs));

    const countSeries = decisions.map((item) => [item.tsMs, item.count]);
    const limitSeries = decisions.map((item) => [item.tsMs, limit]);
    const rejectPoints = decisions.filter((item) => !item.allowed).map((item) => [item.tsMs, item.count]);

    return {
      countSeries,
      limitSeries,
      rejectPoints,
      boundaryLines: windowBoundaries.map((item) => item.windowStartMs),
    };
  }, [events, windowBoundaries, limit]);

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
        trigger: "axis",
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
          name: "Count",
          type: "line",
          data: chartData.countSeries,
          showSymbol: false,
          smooth: false,
          lineStyle: {
            width: 2,
            color: "#0f766e",
          },
          markLine: {
            symbol: ["none", "none"],
            lineStyle: {
              type: "dashed",
              color: "#64748b",
              width: 1,
            },
            data: chartData.boundaryLines.map((value) => ({ xAxis: value })),
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
      <h2>Window Occupancy Chart</h2>
      <div className="chart-surface" ref={containerRef} aria-label="Window occupancy chart" />
    </section>
  );
}
