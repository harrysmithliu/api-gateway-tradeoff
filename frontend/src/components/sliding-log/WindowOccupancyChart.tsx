import { useEffect, useMemo, useRef } from "react";
import { LineChart, ScatterChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { init, use, type EChartsType } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

import type { SlidingLogEvent } from "../../types/slidingLog";

use([LineChart, ScatterChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

type WindowOccupancyChartProps = {
  events: SlidingLogEvent[];
  limit: number;
};

type TooltipPoint = {
  ts: string;
  count: number;
  remaining: number | null;
  allowed: boolean;
};

export function WindowOccupancyChart({ events, limit }: WindowOccupancyChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);

  const chartData = useMemo(() => {
    const decisions = events
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
          count: decision.algorithmState.count,
          remaining: decision.remaining,
          allowed: decision.allowed,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    const countSeries: Array<[number, number, TooltipPoint]> = decisions.map((item) => [
      item.tsMs,
      item.count,
      {
        ts: item.ts,
        count: item.count,
        remaining: item.remaining,
        allowed: item.allowed,
      },
    ]);

    const limitSeries = decisions.map((item) => [item.tsMs, limit]);
    const rejectPoints = decisions
      .filter((item) => !item.allowed)
      .map((item) => [item.tsMs, item.count, item] as [number, number, TooltipPoint]);

    const expiryPoints: Array<[number, number, TooltipPoint]> = [];
    for (let index = 1; index < decisions.length; index += 1) {
      const previous = decisions[index - 1];
      const current = decisions[index];
      if (current.count < previous.count) {
        expiryPoints.push([
          current.tsMs,
          current.count,
          {
            ts: current.ts,
            count: current.count,
            remaining: current.remaining,
            allowed: current.allowed,
          },
        ]);
      }
    }

    return {
      countSeries,
      limitSeries,
      rejectPoints,
      expiryPoints,
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

          const title = params.seriesName ? `${params.seriesName}<br/>` : "";
          return [
            title,
            `ts: ${new Date(point.ts).toLocaleTimeString()}`,
            `count: ${point.count}`,
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
          name: "Count",
          type: "line",
          data: chartData.countSeries,
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
        {
          name: "Expiry Shift",
          type: "scatter",
          data: chartData.expiryPoints,
          symbolSize: 6,
          itemStyle: {
            color: "#0284c7",
          },
          z: 4,
        },
      ],
    });
  }, [chartData]);

  return (
    <section className="card panel">
      <h2>Window Occupancy Chart</h2>
      <p className="meta">Rolling behavior: count can drop when the oldest in-window events expire.</p>
      <div className="chart-surface" ref={containerRef} aria-label="Sliding log window occupancy chart" />
    </section>
  );
}
