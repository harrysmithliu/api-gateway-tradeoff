import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchActiveSlidingWindowCounterPolicy,
  simulateSlidingWindowCounterRequest,
  syncSlidingWindowCounterPolicyConfig,
} from "../api/slidingWindowCounterApi";
import {
  DEFAULT_SLIDING_WINDOW_COUNTER_CONFIG,
  UI_EVENT_CAP,
  type SlidingWindowCounterEvent,
  type SlidingWindowCounterKpiSnapshot,
  type SlidingWindowCounterPolicySnapshot,
  type SlidingWindowCounterSimulationConfig,
  type PolicySyncStatus,
  type SimulationStatus,
} from "../types/slidingWindowCounter";
import {
  createRuntimeControl,
  createSessionId,
  resetRuntimeAfterStop,
  resolveSimulationClientId,
  runSimulationDispatchLoop,
} from "./simulationRuntime";
import { deriveBaseKpiStats } from "./kpiBase";
import { reloadPolicyFromBackend, syncPolicyBeforeStart } from "./policySyncRuntime";

type SimulationSession = {
  id: string;
  startedAtMs: number;
  endedAtMs: number | null;
};

type UseSlidingWindowCounterSimulationValue = {
  status: SimulationStatus;
  config: SlidingWindowCounterSimulationConfig;
  events: SlidingWindowCounterEvent[];
  kpi: SlidingWindowCounterKpiSnapshot;
  session: SimulationSession | null;
  activePolicy: SlidingWindowCounterPolicySnapshot | null;
  policySyncStatus: PolicySyncStatus;
  policySyncMessage: string | null;
  updateConfig: (next: Partial<SlidingWindowCounterSimulationConfig>) => void;
  reloadActivePolicy: () => Promise<void>;
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  resetView: () => void;
};

const INITIAL_KPI: SlidingWindowCounterKpiSnapshot = {
  total: 0,
  allowed: 0,
  rejected: 0,
  allowRate: 0,
  rejectRate: 0,
  currentCount: null,
  currentLimit: DEFAULT_SLIDING_WINDOW_COUNTER_CONFIG.limit,
  currentRemaining: null,
  currentWindowStartMs: null,
  currentWindowEndMs: null,
  observedRps: 0,
  lastRetryAfterMs: null,
  previousContributionRatio: null,
};

const safeNumber = (value: number, min: number): number => {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, value);
};

const clampConfig = (config: SlidingWindowCounterSimulationConfig): SlidingWindowCounterSimulationConfig => ({
  limit: Math.floor(safeNumber(config.limit, 1)),
  windowSizeSec: Math.floor(safeNumber(config.windowSizeSec, 1)),
  rps: Math.floor(safeNumber(config.rps, 1)),
  durationSec: Math.floor(safeNumber(config.durationSec, 1)),
  concurrency: Math.floor(safeNumber(config.concurrency, 1)),
  clientIdMode: config.clientIdMode,
  singleClientId: config.singleClientId.trim() || "client-a",
  rotatingPoolSize: Math.floor(safeNumber(config.rotatingPoolSize, 2)),
});

const deriveKpi = (events: SlidingWindowCounterEvent[], limit: number): SlidingWindowCounterKpiSnapshot => {
  const { total, allowed, rejected, allowRate, rejectRate, latestDecision, lastRetryAfterMs, observedRps, state } =
    deriveBaseKpiStats(events);

  return {
    total,
    allowed,
    rejected,
    allowRate,
    rejectRate,
    currentCount: state?.count ?? null,
    currentLimit: limit,
    currentRemaining: latestDecision?.remaining ?? null,
    currentWindowStartMs: state?.windowStartMs ?? null,
    currentWindowEndMs: state ? state.windowStartMs + state.windowSizeSec * 1000 : null,
    observedRps,
    lastRetryAfterMs,
    previousContributionRatio:
      state && state.estimatedCount > 0
        ? (state.previousWindowCount * state.previousWindowWeight) / state.estimatedCount
        : null,
  };
};

export const useSlidingWindowCounterSimulation = (): UseSlidingWindowCounterSimulationValue => {
  const [status, setStatus] = useState<SimulationStatus>("idle");
  const [config, setConfig] = useState<SlidingWindowCounterSimulationConfig>(DEFAULT_SLIDING_WINDOW_COUNTER_CONFIG);
  const [events, setEvents] = useState<SlidingWindowCounterEvent[]>([]);
  const [session, setSession] = useState<SimulationSession | null>(null);
  const [activePolicy, setActivePolicy] = useState<SlidingWindowCounterPolicySnapshot | null>(null);
  const [policySyncStatus, setPolicySyncStatus] = useState<PolicySyncStatus>("idle");
  const [policySyncMessage, setPolicySyncMessage] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const statusRef = useRef<SimulationStatus>("idle");
  const runtimeRef = useRef(createRuntimeControl());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runtimeRef.current.stopRequested = true;
      runtimeRef.current.pauseRequested = false;
    };
  }, []);

  const appendEvent = useCallback((event: SlidingWindowCounterEvent) => {
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
    await reloadPolicyFromBackend({
      mountedRef,
      setPolicySyncStatus,
      setPolicySyncMessage,
      setActivePolicy,
      setConfig,
      fetchActivePolicy: fetchActiveSlidingWindowCounterPolicy,
      applyLoadedPolicyToConfig: (previous, backendPolicy) =>
        clampConfig({
          ...previous,
          limit: backendPolicy.limit,
          windowSizeSec: backendPolicy.windowSizeSec,
        }),
      loadedMessage: (backendPolicy) =>
        `Loaded active policy ${backendPolicy.name} (limit=${backendPolicy.limit}, window=${backendPolicy.windowSizeSec}s).`,
      emptyMessage: "No active sliding window counter policy found. Start will create or reuse one.",
    });
  }, []);

  useEffect(() => {
    void reloadActivePolicy();
  }, [reloadActivePolicy]);

  const resolveClientId = useCallback((resolvedConfig: SlidingWindowCounterSimulationConfig): string => {
    return resolveSimulationClientId(runtimeRef.current, resolvedConfig);
  }, []);

  const dispatchRequest = useCallback(
    async (resolvedConfig: SlidingWindowCounterSimulationConfig) => {
      const clientId = resolveClientId(resolvedConfig);
      const result = await simulateSlidingWindowCounterRequest({ clientId });
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
      const effectiveConfig = await syncPolicyBeforeStart({
        mountedRef,
        resolvedConfig,
        setPolicySyncStatus,
        setPolicySyncMessage,
        setActivePolicy,
        setConfig,
        syncingMessage: "Syncing frontend limit/window to backend policy...",
        syncPolicy: (currentConfig) =>
          syncSlidingWindowCounterPolicyConfig({
            limit: currentConfig.limit,
            windowSizeSec: currentConfig.windowSizeSec,
            resetRuntimeState: true,
          }),
        applySyncedPolicyToConfig: (currentConfig, syncedPolicy) =>
          clampConfig({
            ...currentConfig,
            limit: syncedPolicy.limit,
            windowSizeSec: syncedPolicy.windowSizeSec,
          }),
        syncedMessage: (syncedPolicy) =>
          `Synced and activated policy ${syncedPolicy.name} (limit=${syncedPolicy.limit}, window=${syncedPolicy.windowSizeSec}s).`,
        appendSyntheticError,
      });
      if (!effectiveConfig) {
        return;
      }

      const nextSession: SimulationSession = {
        id: createSessionId(),
        startedAtMs: Date.now(),
        endedAtMs: null,
      };
      setSession(nextSession);

      const runtime = runtimeRef.current;
      runtime.stopRequested = false;
      runtime.pauseRequested = false;
      runtime.dispatchSequence = 0;
      runtime.inFlight.clear();

      statusRef.current = "running";
      setStatus("running");

      await runSimulationDispatchLoop({
        runtime,
        config: effectiveConfig,
        dispatch: () => dispatchRequest(effectiveConfig),
      });

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
      resetRuntimeAfterStop(runtimeRef.current);
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

  const updateConfig = useCallback((next: Partial<SlidingWindowCounterSimulationConfig>) => {
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
