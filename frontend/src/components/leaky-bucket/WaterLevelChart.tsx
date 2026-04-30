import { useEffect, useMemo, useRef } from "react";
import { LineChart, ScatterChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { init, use, type EChartsType } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

import type { LeakyBucketEvent } from "../../types/leakyBucket";

use([LineChart, ScatterChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

type WaterLevelChartProps = {
  events: LeakyBucketEvent[];
};

type TooltipPoint = {
  ts: string;
  allowed: boolean;
  waterLevel: number;
  capacity: number;
  leakRatePerSec: number;
  waterPerRequest: number;
  remaining: number | null;
  retryAfterMs: number | null;
};

export function WaterLevelChart({ events }: WaterLevelChartProps) {
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
          allowed: decision.allowed,
          remaining: decision.remaining,
          retryAfterMs: decision.retryAfterMs,
          waterLevel: decision.algorithmState.waterLevel,
          capacity: decision.algorithmState.capacity,
          leakRatePerSec: decision.algorithmState.leakRatePerSec,
          waterPerRequest: decision.algorithmState.waterPerRequest,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    const waterSeries: Array<[number, number, TooltipPoint]> = decisions.map((item) => [
      item.tsMs,
      item.waterLevel,
      {
        ts: item.ts,
        allowed: item.allowed,
        waterLevel: item.waterLevel,
        capacity: item.capacity,
        leakRatePerSec: item.leakRatePerSec,
        waterPerRequest: item.waterPerRequest,
        remaining: item.remaining,
        retryAfterMs: item.retryAfterMs,
      },
    ]);

    const capacitySeries = decisions.map((item) => [item.tsMs, item.capacity]);

    const rejectPoints: Array<[number, number, TooltipPoint]> = decisions
      .filter((item) => !item.allowed)
      .map((item) => [
        item.tsMs,
        item.waterLevel,
        {
          ts: item.ts,
          allowed: item.allowed,
          waterLevel: item.waterLevel,
          capacity: item.capacity,
          leakRatePerSec: item.leakRatePerSec,
          waterPerRequest: item.waterPerRequest,
          remaining: item.remaining,
          retryAfterMs: item.retryAfterMs,
        },
      ]);

    const leakShiftPoints: Array<[number, number, TooltipPoint]> = [];
    for (let index = 1; index < decisions.length; index += 1) {
      const previous = decisions[index - 1];
      const current = decisions[index];
      if (current.waterLevel < previous.waterLevel) {
        leakShiftPoints.push([
          current.tsMs,
          current.waterLevel,
          {
            ts: current.ts,
            allowed: current.allowed,
            waterLevel: current.waterLevel,
            capacity: current.capacity,
            leakRatePerSec: current.leakRatePerSec,
            waterPerRequest: current.waterPerRequest,
            remaining: current.remaining,
            retryAfterMs: current.retryAfterMs,
          },
        ]);
      }
    }

    const maxCapacity = decisions.reduce((acc, item) => Math.max(acc, item.capacity), 0);
    const maxWater = decisions.reduce((acc, item) => Math.max(acc, item.waterLevel), 0);
    const yMax = Math.max(1, Math.ceil(Math.max(maxCapacity, maxWater) * 1.15));

    return {
      waterSeries,
      capacitySeries,
      rejectPoints,
      leakShiftPoints,
      yMax,
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

          const title = params.seriesName ? `${params.seriesName}<br/>` : "";
          return [
            title,
            `ts: ${new Date(point.ts).toLocaleTimeString()}`,
            `allowed: ${point.allowed}`,
            `water_level: ${point.waterLevel.toFixed(3)}`,
            `capacity: ${point.capacity}`,
            `leak_rate_per_sec: ${point.leakRatePerSec}`,
            `water_per_request: ${point.waterPerRequest}`,
            `remaining_headroom: ${point.remaining ?? "-"}`,
            `retry_after_ms: ${point.retryAfterMs ?? "-"}`,
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
        max: chartData.yMax,
      },
      series: [
        {
          name: "Water Level",
          type: "line",
          data: chartData.waterSeries,
          showSymbol: false,
          smooth: false,
          lineStyle: {
            width: 2,
            color: "#0f766e",
          },
        },
        {
          name: "Capacity",
          type: "line",
          data: chartData.capacitySeries,
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
          name: "Leak Shift",
          type: "scatter",
          data: chartData.leakShiftPoints,
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
      <h2>Water Level Chart</h2>
      <p className="meta">Leaky behavior: water drains continuously; sustained inflow above leak rate pushes backlog toward capacity.</p>
      <div className="chart-surface" ref={containerRef} aria-label="Leaky bucket water level chart" />
    </section>
  );
}
