import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchActiveFixedWindowPolicy,
  simulateFixedWindowRequest,
  syncFixedWindowPolicyConfig,
} from "../api/fixedWindowApi";
import {
  DEFAULT_FIXED_WINDOW_CONFIG,
  UI_EVENT_CAP,
  type FixedWindowBoundary,
  type FixedWindowEvent,
  type FixedWindowKpiSnapshot,
  type FixedWindowPolicySnapshot,
  type FixedWindowSimulationConfig,
  type PolicySyncStatus,
  type SimulationStatus,
} from "../types/fixedWindow";
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

type UseFixedWindowSimulationValue = {
  status: SimulationStatus;
  config: FixedWindowSimulationConfig;
  events: FixedWindowEvent[];
  kpi: FixedWindowKpiSnapshot;
  windowBoundaries: FixedWindowBoundary[];
  session: SimulationSession | null;
  activePolicy: FixedWindowPolicySnapshot | null;
  policySyncStatus: PolicySyncStatus;
  policySyncMessage: string | null;
  updateConfig: (next: Partial<FixedWindowSimulationConfig>) => void;
  reloadActivePolicy: () => Promise<void>;
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  resetView: () => void;
};

const INITIAL_KPI: FixedWindowKpiSnapshot = {
  total: 0,
  allowed: 0,
  rejected: 0,
  allowRate: 0,
  rejectRate: 0,
  currentCount: null,
  currentLimit: DEFAULT_FIXED_WINDOW_CONFIG.limit,
  currentRemaining: null,
  currentWindowStartMs: null,
  currentWindowEndMs: null,
  observedRps: 0,
  lastRetryAfterMs: null,
};

const safeNumber = (value: number, min: number): number => {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, value);
};

const clampConfig = (config: FixedWindowSimulationConfig): FixedWindowSimulationConfig => ({
  limit: Math.floor(safeNumber(config.limit, 1)),
  windowSizeSec: Math.floor(safeNumber(config.windowSizeSec, 1)),
  rps: Math.floor(safeNumber(config.rps, 1)),
  durationSec: Math.floor(safeNumber(config.durationSec, 1)),
  concurrency: Math.floor(safeNumber(config.concurrency, 1)),
  clientIdMode: config.clientIdMode,
  singleClientId: config.singleClientId.trim() || "client-a",
  rotatingPoolSize: Math.floor(safeNumber(config.rotatingPoolSize, 2)),
});

const deriveKpi = (events: FixedWindowEvent[], limit: number): FixedWindowKpiSnapshot => {
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
  };
};

const deriveBoundaries = (events: FixedWindowEvent[]): FixedWindowBoundary[] => {
  const seen = new Set<number>();
  const boundaries: FixedWindowBoundary[] = [];

  events.forEach((event) => {
    const state = event.decision?.algorithmState;
    if (!state) {
      return;
    }
    if (seen.has(state.windowStartMs)) {
      return;
    }

    seen.add(state.windowStartMs);
    boundaries.push({
      windowStartMs: state.windowStartMs,
      windowEndMs: state.windowStartMs + state.windowSizeSec * 1000,
    });
  });

  return boundaries.sort((a, b) => a.windowStartMs - b.windowStartMs);
};

export const useFixedWindowSimulation = (): UseFixedWindowSimulationValue => {
  const [status, setStatus] = useState<SimulationStatus>("idle");
  const [config, setConfig] = useState<FixedWindowSimulationConfig>(DEFAULT_FIXED_WINDOW_CONFIG);
  const [events, setEvents] = useState<FixedWindowEvent[]>([]);
  const [session, setSession] = useState<SimulationSession | null>(null);
  const [activePolicy, setActivePolicy] = useState<FixedWindowPolicySnapshot | null>(null);
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

  const appendEvent = useCallback((event: FixedWindowEvent) => {
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
      fetchActivePolicy: fetchActiveFixedWindowPolicy,
      applyLoadedPolicyToConfig: (previous, backendPolicy) =>
        clampConfig({
          ...previous,
          limit: backendPolicy.limit,
          windowSizeSec: backendPolicy.windowSizeSec,
        }),
      loadedMessage: (backendPolicy) =>
        `Loaded active policy ${backendPolicy.name} (limit=${backendPolicy.limit}, window=${backendPolicy.windowSizeSec}s).`,
      emptyMessage: "No active fixed window policy found. Start will create or reuse one.",
    });
  }, []);

  useEffect(() => {
    void reloadActivePolicy();
  }, [reloadActivePolicy]);

  const resolveClientId = useCallback((resolvedConfig: FixedWindowSimulationConfig): string => {
    return resolveSimulationClientId(runtimeRef.current, resolvedConfig);
  }, []);

  const dispatchRequest = useCallback(
    async (resolvedConfig: FixedWindowSimulationConfig) => {
      const clientId = resolveClientId(resolvedConfig);
      const result = await simulateFixedWindowRequest({ clientId });
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
          syncFixedWindowPolicyConfig({
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

  const updateConfig = useCallback((next: Partial<FixedWindowSimulationConfig>) => {
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

  const windowBoundaries = useMemo(() => deriveBoundaries(events), [events]);

  return {
    status,
    config,
    events,
    kpi,
    windowBoundaries,
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
