import { useEffect, useMemo, useRef } from "react";
import { LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { init, use, type EChartsType } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

import type { TimeseriesPoint } from "../types";

use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

type ComparisonChartProps = {
  points: TimeseriesPoint[];
  windowSec: number;
  onWindowChange: (windowSec: number) => void;
};

const WINDOW_OPTIONS = [60, 120, 300] as const;

export function ComparisonChart({ points, windowSec, onWindowChange }: ComparisonChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);

  const chartData = useMemo(() => {
    return points.map((point) => ({
      time: new Date(point.ts * 1000).toLocaleTimeString(),
      qps: point.qps,
      rejectRate: Number((point.reject_rate * 100).toFixed(2)),
      p99: point.p99_ms,
    }));
  }, [points]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    chartRef.current = init(containerRef.current);
    const currentChart = chartRef.current;

    const resizeObserver = new ResizeObserver(() => {
      currentChart.resize();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      currentChart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!chartRef.current) {
      return;
    }

    chartRef.current.setOption({
      backgroundColor: "transparent",
      animationDuration: 450,
      tooltip: {
        trigger: "axis",
      },
      legend: {
        top: 10,
      },
      grid: {
        left: 20,
        right: 24,
        top: 56,
        bottom: 24,
        containLabel: true,
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: chartData.map((entry) => entry.time),
      },
      yAxis: [
        {
          type: "value",
          name: "QPS / Reject %",
          splitLine: { lineStyle: { opacity: 0.22 } },
        },
        {
          type: "value",
          name: "P99 Latency (ms)",
          position: "right",
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: "QPS",
          type: "line",
          smooth: true,
          yAxisIndex: 0,
          data: chartData.map((entry) => entry.qps),
          lineStyle: { width: 2.5 },
          showSymbol: false,
          color: "#0f766e",
        },
        {
          name: "Reject Rate (%)",
          type: "line",
          smooth: true,
          yAxisIndex: 0,
          data: chartData.map((entry) => entry.rejectRate),
          lineStyle: { width: 2.5 },
          showSymbol: false,
          color: "#ea580c",
        },
        {
          name: "P99 (ms)",
          type: "line",
          smooth: true,
          yAxisIndex: 1,
          data: chartData.map((entry) => entry.p99),
          lineStyle: { width: 2.5 },
          showSymbol: false,
          color: "#0369a1",
        },
      ],
    });
  }, [chartData]);

  return (
    <section className="card panel">
      <div className="panel-header">
        <h2>Single-Panel Comparison</h2>
        <div className="segmented-control" role="group" aria-label="Time window switch">
          {WINDOW_OPTIONS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onWindowChange(value)}
              className={windowSec === value ? "selected" : ""}
            >
              {value}s
            </button>
          ))}
        </div>
      </div>
      <div ref={containerRef} className="chart-container" aria-label="QPS Reject Rate and P99 chart" />
    </section>
  );
}
