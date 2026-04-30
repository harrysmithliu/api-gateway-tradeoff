import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ApiError,
  fetchActiveSlidingLogPolicy,
  simulateSlidingLogRequest,
  syncSlidingLogPolicyConfig,
} from "../api/slidingLogApi";
import {
  DEFAULT_SLIDING_LOG_CONFIG,
  UI_EVENT_CAP,
  type SlidingLogEvent,
  type SlidingLogKpiSnapshot,
  type SlidingLogPolicySnapshot,
  type SlidingLogSimulationConfig,
  type PolicySyncStatus,
  type SimulationStatus,
} from "../types/slidingLog";

type SimulationSession = {
  id: string;
  startedAtMs: number;
  endedAtMs: number | null;
};

type UseSlidingLogSimulationValue = {
  status: SimulationStatus;
  config: SlidingLogSimulationConfig;
  events: SlidingLogEvent[];
  kpi: SlidingLogKpiSnapshot;
  session: SimulationSession | null;
  activePolicy: SlidingLogPolicySnapshot | null;
  policySyncStatus: PolicySyncStatus;
  policySyncMessage: string | null;
  updateConfig: (next: Partial<SlidingLogSimulationConfig>) => void;
  reloadActivePolicy: () => Promise<void>;
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  resetView: () => void;
};

type RuntimeControl = {
  stopRequested: boolean;
  pauseRequested: boolean;
  dispatchSequence: number;
  inFlight: Set<Promise<void>>;
};

const INITIAL_KPI: SlidingLogKpiSnapshot = {
  total: 0,
  allowed: 0,
  rejected: 0,
  allowRate: 0,
  rejectRate: 0,
  currentCount: null,
  currentLimit: DEFAULT_SLIDING_LOG_CONFIG.limit,
  currentRemaining: null,
  currentWindowStartMs: null,
  currentWindowEndMs: null,
  observedRps: 0,
  lastRetryAfterMs: null,
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const safeNumber = (value: number, min: number): number => {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, value);
};

const clampConfig = (config: SlidingLogSimulationConfig): SlidingLogSimulationConfig => ({
  limit: Math.floor(safeNumber(config.limit, 1)),
  windowSizeSec: Math.floor(safeNumber(config.windowSizeSec, 1)),
  rps: Math.floor(safeNumber(config.rps, 1)),
  durationSec: Math.floor(safeNumber(config.durationSec, 1)),
  concurrency: Math.floor(safeNumber(config.concurrency, 1)),
  clientIdMode: config.clientIdMode,
  singleClientId: config.singleClientId.trim() || "client-a",
  rotatingPoolSize: Math.floor(safeNumber(config.rotatingPoolSize, 2)),
});

const createSessionId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}`;
};

const deriveKpi = (events: SlidingLogEvent[], limit: number): SlidingLogKpiSnapshot => {
  const decisionEvents = events.filter((event) => event.kind === "decision" && event.decision !== null);
  const total = decisionEvents.length;
  const allowed = decisionEvents.filter((event) => event.decision?.allowed).length;
  const rejected = total - allowed;

  let latestDecision = null;
  for (let index = decisionEvents.length - 1; index >= 0; index -= 1) {
    const current = decisionEvents[index].decision;
    if (current) {
      latestDecision = current;
      break;
    }
  }

  let lastRetryAfterMs: number | null = null;
  for (let index = decisionEvents.length - 1; index >= 0; index -= 1) {
    const current = decisionEvents[index].decision;
    if (current && !current.allowed && current.retryAfterMs !== null) {
      lastRetryAfterMs = current.retryAfterMs;
      break;
    }
  }

  const nowMs = Date.now();
  const observedRps = decisionEvents.filter((event) => {
    const tsMs = Date.parse(event.ts);
    return Number.isFinite(tsMs) && nowMs - tsMs <= 1000;
  }).length;

  const state = latestDecision?.algorithmState ?? null;

  return {
    total,
    allowed,
    rejected,
    allowRate: total > 0 ? allowed / total : 0,
    rejectRate: total > 0 ? rejected / total : 0,
    currentCount: state?.count ?? null,
    currentLimit: limit,
    currentRemaining: latestDecision?.remaining ?? null,
    currentWindowStartMs: state?.windowStartMs ?? null,
    currentWindowEndMs: state ? state.windowStartMs + state.windowSizeSec * 1000 : null,
    observedRps,
    lastRetryAfterMs,
  };
};

export const useSlidingLogSimulation = (): UseSlidingLogSimulationValue => {
  const [status, setStatus] = useState<SimulationStatus>("idle");
  const [config, setConfig] = useState<SlidingLogSimulationConfig>(DEFAULT_SLIDING_LOG_CONFIG);
  const [events, setEvents] = useState<SlidingLogEvent[]>([]);
  const [session, setSession] = useState<SimulationSession | null>(null);
  const [activePolicy, setActivePolicy] = useState<SlidingLogPolicySnapshot | null>(null);
  const [policySyncStatus, setPolicySyncStatus] = useState<PolicySyncStatus>("idle");
  const [policySyncMessage, setPolicySyncMessage] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const statusRef = useRef<SimulationStatus>("idle");
  const runtimeRef = useRef<RuntimeControl>({
    stopRequested: false,
    pauseRequested: false,
    dispatchSequence: 0,
    inFlight: new Set(),
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runtimeRef.current.stopRequested = true;
      runtimeRef.current.pauseRequested = false;
    };
  }, []);

  const appendEvent = useCallback((event: SlidingLogEvent) => {
    setEvents((previous) => {
      const next = [...previous, event];
      if (next.length <= UI_EVENT_CAP) {
        return next;
      }
      return next.slice(next.length - UI_EVENT_CAP);
    });
  }, []);

  const appendSyntheticError = useCallback((message: string) => {
    appendEvent({
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      kind: "synthetic_error",
      decision: null,
      issues: [
        {
          code: "request_error",
          severity: "error",
          message,
        },
      ],
    });
  }, [appendEvent]);

  const reloadActivePolicy = useCallback(async () => {
    setPolicySyncStatus("loading");
    try {
      const backendPolicy = await fetchActiveSlidingLogPolicy();
      if (!mountedRef.current) {
        return;
      }

      if (backendPolicy) {
        setActivePolicy(backendPolicy);
        setConfig((previous) =>
          clampConfig({
            ...previous,
            limit: backendPolicy.limit,
            windowSizeSec: backendPolicy.windowSizeSec,
          }),
        );
        setPolicySyncStatus("ready");
        setPolicySyncMessage(
          `Loaded active policy ${backendPolicy.name} (limit=${backendPolicy.limit}, window=${backendPolicy.windowSizeSec}s).`,
        );
      } else {
        setActivePolicy(null);
        setPolicySyncStatus("ready");
        setPolicySyncMessage("No active sliding log policy found. Start will create or reuse one.");
      }
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }
      setPolicySyncStatus("error");
      setPolicySyncMessage(error instanceof Error ? error.message : "Failed to load active policy.");
    }
  }, []);

  useEffect(() => {
    void reloadActivePolicy();
  }, [reloadActivePolicy]);

  const resolveClientId = useCallback((resolvedConfig: SlidingLogSimulationConfig): string => {
    const runtime = runtimeRef.current;
    if (resolvedConfig.clientIdMode === "single") {
      return resolvedConfig.singleClientId;
    }

    const poolIndex = runtime.dispatchSequence % resolvedConfig.rotatingPoolSize;
    runtime.dispatchSequence += 1;
    return `client-${poolIndex + 1}`;
  }, []);

  const dispatchRequest = useCallback(
    async (resolvedConfig: SlidingLogSimulationConfig) => {
      const clientId = resolveClientId(resolvedConfig);
      const result = await simulateSlidingLogRequest({ clientId });
      if (!mountedRef.current) {
        return;
      }
      appendEvent(result.event);
    },
    [appendEvent, resolveClientId],
  );

  const start = useCallback(() => {
    if (statusRef.current === "running" || statusRef.current === "paused" || statusRef.current === "stopping") {
      return;
    }
    if (policySyncStatus === "syncing") {
      return;
    }

    const resolvedConfig = clampConfig(config);
    setConfig(resolvedConfig);

    void (async () => {
      setPolicySyncStatus("syncing");
      setPolicySyncMessage("Syncing frontend limit/window to backend policy...");
      let effectiveConfig = resolvedConfig;

      try {
        const syncedPolicy = await syncSlidingLogPolicyConfig({
          limit: resolvedConfig.limit,
          windowSizeSec: resolvedConfig.windowSizeSec,
          resetRuntimeState: true,
        });
        if (!mountedRef.current) {
          return;
        }
        setActivePolicy(syncedPolicy);
        effectiveConfig = clampConfig({
          ...resolvedConfig,
          limit: syncedPolicy.limit,
          windowSizeSec: syncedPolicy.windowSizeSec,
        });
        setConfig(effectiveConfig);
        setPolicySyncStatus("ready");
        setPolicySyncMessage(
          `Synced and activated policy ${syncedPolicy.name} (limit=${syncedPolicy.limit}, window=${syncedPolicy.windowSizeSec}s).`,
        );
      } catch (error) {
        if (!mountedRef.current) {
          return;
        }
        const message =
          error instanceof ApiError
            ? `${error.message} (HTTP ${error.status})`
            : error instanceof Error
              ? error.message
              : "Failed to sync policy.";
        setPolicySyncStatus("error");
        setPolicySyncMessage(message);
        appendSyntheticError(`Policy sync failed: ${message}`);
        return;
      }

      const nextSession: SimulationSession = {
        id: createSessionId(),
        startedAtMs: Date.now(),
        endedAtMs: null,
      };
      setSession(nextSession);

      runtimeRef.current.stopRequested = false;
      runtimeRef.current.pauseRequested = false;
      runtimeRef.current.dispatchSequence = 0;
      runtimeRef.current.inFlight.clear();

      statusRef.current = "running";
      setStatus("running");

      const simulationDeadline = Date.now() + effectiveConfig.durationSec * 1000;

      let tokenBudget = 0;
      let lastTickMs = Date.now();

      while (!runtimeRef.current.stopRequested) {
        const nowMs = Date.now();

        if (nowMs >= simulationDeadline) {
          break;
        }

        if (runtimeRef.current.pauseRequested) {
          await sleep(60);
          continue;
        }

        const elapsedMs = nowMs - lastTickMs;
        lastTickMs = nowMs;
        tokenBudget += (elapsedMs / 1000) * effectiveConfig.rps;
        tokenBudget = Math.min(tokenBudget, effectiveConfig.rps * 2);

        let dispatched = false;
        while (
          tokenBudget >= 1 &&
          runtimeRef.current.inFlight.size < effectiveConfig.concurrency &&
          !runtimeRef.current.stopRequested &&
          !runtimeRef.current.pauseRequested
        ) {
          tokenBudget -= 1;
          dispatched = true;

          const task = dispatchRequest(effectiveConfig).finally(() => {
            runtimeRef.current.inFlight.delete(task);
          });
          runtimeRef.current.inFlight.add(task);
        }

        if (!dispatched) {
          await sleep(12);
        }
      }

      if (runtimeRef.current.inFlight.size > 0) {
        await Promise.allSettled(Array.from(runtimeRef.current.inFlight));
      }

      if (!mountedRef.current) {
        return;
      }

      statusRef.current = "idle";
      setStatus("idle");
      setSession((previous) =>
        previous
          ? {
              ...previous,
              endedAtMs: Date.now(),
            }
          : previous,
      );
      runtimeRef.current.stopRequested = false;
      runtimeRef.current.pauseRequested = false;
    })();
  }, [appendSyntheticError, config, dispatchRequest, policySyncStatus]);

  const pause = useCallback(() => {
    if (statusRef.current !== "running") {
      return;
    }
    runtimeRef.current.pauseRequested = true;
    statusRef.current = "paused";
    setStatus("paused");
  }, []);

  const resume = useCallback(() => {
    if (statusRef.current !== "paused") {
      return;
    }
    runtimeRef.current.pauseRequested = false;
    statusRef.current = "running";
    setStatus("running");
  }, []);

  const stop = useCallback(() => {
    if (statusRef.current === "idle") {
      return;
    }
    runtimeRef.current.stopRequested = true;
    runtimeRef.current.pauseRequested = false;
    statusRef.current = "stopping";
    setStatus("stopping");
  }, []);

  const resetView = useCallback(() => {
    setEvents([]);
  }, []);

  const updateConfig = useCallback((next: Partial<SlidingLogSimulationConfig>) => {
    setConfig((previous) => clampConfig({ ...previous, ...next }));
  }, []);

  const kpi = useMemo(() => {
    if (events.length === 0) {
      return {
        ...INITIAL_KPI,
        currentLimit: config.limit,
      };
    }
    return deriveKpi(events, config.limit);
  }, [events, config.limit]);

  return {
    status,
    config,
    events,
    kpi,
    session,
    activePolicy,
    policySyncStatus,
    policySyncMessage,
    updateConfig,
    reloadActivePolicy,
    start,
    pause,
    resume,
    stop,
    resetView,
  };
};
