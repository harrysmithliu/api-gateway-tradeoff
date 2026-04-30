import { useEffect, useMemo, useRef } from "react";
import { LineChart, ScatterChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { init, use, type EChartsType } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

import type { TokenBucketEvent } from "../../types/tokenBucket";

use([LineChart, ScatterChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

type TokensOverTimeChartProps = {
  events: TokenBucketEvent[];
};

type TooltipPoint = {
  ts: string;
  allowed: boolean;
  tokens: number;
  capacity: number;
  refillRatePerSec: number;
  tokensPerRequest: number;
  remaining: number | null;
  retryAfterMs: number | null;
};

export function TokensOverTimeChart({ events }: TokensOverTimeChartProps) {
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
          tokens: decision.algorithmState.tokens,
          capacity: decision.algorithmState.capacity,
          refillRatePerSec: decision.algorithmState.refillRatePerSec,
          tokensPerRequest: decision.algorithmState.tokensPerRequest,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    const tokenSeries: Array<[number, number, TooltipPoint]> = decisions.map((item) => [
      item.tsMs,
      item.tokens,
      {
        ts: item.ts,
        allowed: item.allowed,
        tokens: item.tokens,
        capacity: item.capacity,
        refillRatePerSec: item.refillRatePerSec,
        tokensPerRequest: item.tokensPerRequest,
        remaining: item.remaining,
        retryAfterMs: item.retryAfterMs,
      },
    ]);

    const capacitySeries = decisions.map((item) => [item.tsMs, item.capacity]);

    const rejectPoints: Array<[number, number, TooltipPoint]> = decisions
      .filter((item) => !item.allowed)
      .map((item) => [
        item.tsMs,
        item.tokens,
        {
          ts: item.ts,
          allowed: item.allowed,
          tokens: item.tokens,
          capacity: item.capacity,
          refillRatePerSec: item.refillRatePerSec,
          tokensPerRequest: item.tokensPerRequest,
          remaining: item.remaining,
          retryAfterMs: item.retryAfterMs,
        },
      ]);

    const refillPoints: Array<[number, number, TooltipPoint]> = [];
    for (let index = 1; index < decisions.length; index += 1) {
      const previous = decisions[index - 1];
      const current = decisions[index];
      if (current.tokens > previous.tokens) {
        refillPoints.push([
          current.tsMs,
          current.tokens,
          {
            ts: current.ts,
            allowed: current.allowed,
            tokens: current.tokens,
            capacity: current.capacity,
            refillRatePerSec: current.refillRatePerSec,
            tokensPerRequest: current.tokensPerRequest,
            remaining: current.remaining,
            retryAfterMs: current.retryAfterMs,
          },
        ]);
      }
    }

    const maxCapacity = decisions.reduce((acc, item) => Math.max(acc, item.capacity), 0);
    const maxTokens = decisions.reduce((acc, item) => Math.max(acc, item.tokens), 0);
    const yMax = Math.max(1, Math.ceil(Math.max(maxCapacity, maxTokens) * 1.15));

    return {
      tokenSeries,
      capacitySeries,
      rejectPoints,
      refillPoints,
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
            `tokens: ${point.tokens.toFixed(3)}`,
            `capacity: ${point.capacity}`,
            `refill_rate_per_sec: ${point.refillRatePerSec}`,
            `tokens_per_request: ${point.tokensPerRequest}`,
            `remaining_budget: ${point.remaining ?? "-"}`,
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
          name: "Tokens",
          type: "line",
          data: chartData.tokenSeries,
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
          name: "Refill Shift",
          type: "scatter",
          data: chartData.refillPoints,
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
      <h2>Token Level Chart</h2>
      <p className="meta">Token bucket behavior: tokens refill continuously and are consumed on each allowed request.</p>
      <div className="chart-surface" ref={containerRef} aria-label="Token bucket tokens over time chart" />
    </section>
  );
}
