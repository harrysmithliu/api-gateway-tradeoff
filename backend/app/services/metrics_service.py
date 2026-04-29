from __future__ import annotations

import math
import time
from uuid import UUID

from redis.asyncio import Redis

from app.schemas.metrics import MetricsSummaryResponse, TimeseriesPoint

METRICS_TTL_SEC = 24 * 60 * 60
LATENCY_SAMPLES_PER_SECOND_CAP = 400


class MetricsService:
    def __init__(self, redis_client: Redis):
        self.redis_client = redis_client

    async def record_decision(
        self,
        *,
        run_id: UUID | None,
        allowed: bool,
        latency_ms: int,
    ) -> None:
        now_sec = int(time.time())
        scopes = ["global"]
        if run_id is not None:
            scopes.append(f"run:{run_id}")

        for scope in scopes:
            metrics_key = f"metrics:{scope}:{now_sec}"
            latency_key = f"metrics_latency:{scope}:{now_sec}"

            pipe = self.redis_client.pipeline(transaction=False)
            pipe.hincrby(metrics_key, "total", 1)
            pipe.hincrby(metrics_key, "allowed", 1 if allowed else 0)
            pipe.hincrby(metrics_key, "rejected", 0 if allowed else 1)
            pipe.hincrby(metrics_key, "latency_sum_ms", int(latency_ms))
            pipe.expire(metrics_key, METRICS_TTL_SEC)
            pipe.rpush(latency_key, int(latency_ms))
            pipe.ltrim(latency_key, -LATENCY_SAMPLES_PER_SECOND_CAP, -1)
            pipe.expire(latency_key, METRICS_TTL_SEC)
            await pipe.execute()

    async def get_summary(self, window_sec: int, run_id: UUID | None) -> MetricsSummaryResponse:
        buckets = await self._load_buckets(window_sec=window_sec, run_id=run_id)

        total = sum(bucket["total"] for bucket in buckets)
        allowed = sum(bucket["allowed"] for bucket in buckets)
        rejected = sum(bucket["rejected"] for bucket in buckets)
        latency_values: list[float] = []
        for bucket in buckets:
            latency_values.extend(bucket["latencies"])

        accept_rate = (allowed / total) if total > 0 else 0.0
        reject_rate = (rejected / total) if total > 0 else 0.0
        qps = (total / window_sec) if window_sec > 0 else 0.0

        p50 = self._percentile(latency_values, 50)
        p95 = self._percentile(latency_values, 95)
        p99 = self._percentile(latency_values, 99)

        per_second_qps = [float(bucket["total"]) for bucket in buckets]
        peak_qps = max(per_second_qps) if per_second_qps else 0.0

        return MetricsSummaryResponse(
            total=total,
            allowed=allowed,
            rejected=rejected,
            accept_rate=round(accept_rate, 6),
            reject_rate=round(reject_rate, 6),
            qps=round(qps, 4),
            p50=round(p50, 4),
            p95=round(p95, 4),
            p99=round(p99, 4),
            peak_qps=round(peak_qps, 4),
        )

    async def get_timeseries(self, window_sec: int, step_sec: int, run_id: UUID | None) -> list[TimeseriesPoint]:
        buckets = await self._load_buckets(window_sec=window_sec, run_id=run_id)
        if not buckets:
            return []

        points: list[TimeseriesPoint] = []
        prev_qps = 0.0

        for index in range(0, len(buckets), step_sec):
            segment = buckets[index : index + step_sec]
            if not segment:
                continue

            segment_total = sum(item["total"] for item in segment)
            segment_allowed = sum(item["allowed"] for item in segment)
            segment_rejected = sum(item["rejected"] for item in segment)
            segment_latencies: list[float] = []
            for item in segment:
                segment_latencies.extend(item["latencies"])

            qps = segment_total / step_sec
            reject_rate = (segment_rejected / segment_total) if segment_total > 0 else 0.0
            p99_ms = self._percentile(segment_latencies, 99)
            peak_delta = qps - prev_qps

            points.append(
                TimeseriesPoint(
                    ts=segment[0]["ts"],
                    qps=round(qps, 4),
                    allowed=segment_allowed,
                    rejected=segment_rejected,
                    reject_rate=round(reject_rate, 6),
                    p99_ms=round(p99_ms, 4),
                    peak_delta=round(peak_delta, 4),
                )
            )
            prev_qps = qps

        return points

    async def _load_buckets(self, *, window_sec: int, run_id: UUID | None) -> list[dict[str, object]]:
        scope = f"run:{run_id}" if run_id is not None else "global"
        now_sec = int(time.time())
        start_sec = max(now_sec - window_sec + 1, 0)
        epochs = list(range(start_sec, now_sec + 1))

        if not epochs:
            return []

        metrics_keys = [f"metrics:{scope}:{epoch}" for epoch in epochs]
        latency_keys = [f"metrics_latency:{scope}:{epoch}" for epoch in epochs]

        metrics_pipe = self.redis_client.pipeline(transaction=False)
        for key in metrics_keys:
            metrics_pipe.hgetall(key)
        metrics_rows = await metrics_pipe.execute()

        latency_pipe = self.redis_client.pipeline(transaction=False)
        for key in latency_keys:
            latency_pipe.lrange(key, 0, -1)
        latency_rows = await latency_pipe.execute()

        buckets: list[dict[str, object]] = []
        for idx, epoch in enumerate(epochs):
            metrics = metrics_rows[idx] or {}
            latencies_raw = latency_rows[idx] or []

            latencies: list[float] = []
            for value in latencies_raw:
                try:
                    latencies.append(float(value))
                except (TypeError, ValueError):
                    continue

            buckets.append(
                {
                    "ts": int(epoch),
                    "total": int(metrics.get("total", 0) or 0),
                    "allowed": int(metrics.get("allowed", 0) or 0),
                    "rejected": int(metrics.get("rejected", 0) or 0),
                    "latencies": latencies,
                }
            )

        return buckets

    @staticmethod
    def _percentile(values: list[float], percentile: int) -> float:
        if not values:
            return 0.0
        if len(values) == 1:
            return float(values[0])

        sorted_values = sorted(values)
        rank = (percentile / 100) * (len(sorted_values) - 1)
        lower = math.floor(rank)
        upper = math.ceil(rank)
        if lower == upper:
            return float(sorted_values[lower])

        weight = rank - lower
        return float(sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * weight)
