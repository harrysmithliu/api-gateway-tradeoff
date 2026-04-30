import { useEffect, useMemo, useRef } from "react";
import { LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { init, use, type EChartsType } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

import type { SlidingWindowCounterEvent } from "../../types/slidingWindowCounter";

use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

type ContributionSplitChartProps = {
  events: SlidingWindowCounterEvent[];
};

type TooltipPoint = {
  ts: string;
  currentWindowCount: number;
  previousWeightedContribution: number;
  estimatedCount: number;
};

export function ContributionSplitChart({ events }: ContributionSplitChartProps) {
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

        const previousWeightedContribution =
          decision.algorithmState.previousWindowCount * decision.algorithmState.previousWindowWeight;

        return {
          ts: event.ts,
          tsMs,
          currentWindowCount: decision.algorithmState.currentWindowCount,
          previousWeightedContribution,
          estimatedCount: decision.algorithmState.estimatedCount,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    const currentSeries: Array<[number, number, TooltipPoint]> = points.map((item) => [
      item.tsMs,
      item.currentWindowCount,
      item,
    ]);

    const previousWeightedSeries: Array<[number, number, TooltipPoint]> = points.map((item) => [
      item.tsMs,
      item.previousWeightedContribution,
      item,
    ]);

    const estimatedSeries = points.map((item) => [item.tsMs, item.estimatedCount]);

    return {
      currentSeries,
      previousWeightedSeries,
      estimatedSeries,
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
        formatter: (params: { seriesName?: string; data?: [number, number, TooltipPoint] }) => {
          const point = params.data?.[2];
          if (!point) {
            return "No data";
          }
          return [
            `${params.seriesName ?? "Point"}`,
            `ts: ${new Date(point.ts).toLocaleTimeString()}`,
            `current_window_count: ${point.currentWindowCount}`,
            `previous_weighted: ${point.previousWeightedContribution.toFixed(3)}`,
            `estimated_count: ${point.estimatedCount.toFixed(3)}`,
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
          name: "Current Window Contribution",
          type: "line",
          data: chartData.currentSeries,
          showSymbol: false,
          smooth: false,
          lineStyle: {
            width: 2,
            color: "#0ea5e9",
          },
          areaStyle: {
            color: "rgba(14, 165, 233, 0.14)",
          },
        },
        {
          name: "Previous Weighted Contribution",
          type: "line",
          data: chartData.previousWeightedSeries,
          showSymbol: false,
          smooth: false,
          lineStyle: {
            width: 2,
            color: "#f59e0b",
          },
          areaStyle: {
            color: "rgba(245, 158, 11, 0.14)",
          },
        },
        {
          name: "Estimated Count",
          type: "line",
          data: chartData.estimatedSeries,
          showSymbol: false,
          smooth: false,
          lineStyle: {
            width: 1,
            type: "dashed",
            color: "#334155",
          },
        },
      ],
    });
  }, [chartData]);

  return (
    <section className="card panel">
      <h2>Contribution Split Chart</h2>
      <p className="meta">SWC smoothing source: current-window count plus weighted carry-over from previous window.</p>
      <div className="chart-surface" ref={containerRef} aria-label="SWC contribution split chart" />
    </section>
  );
}
