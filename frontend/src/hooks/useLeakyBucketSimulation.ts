import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchActiveLeakyBucketPolicy,
  simulateLeakyBucketRequest,
  syncLeakyBucketPolicyConfig,
} from "../api/leakyBucketApi";
import {
  DEFAULT_LEAKY_BUCKET_CONFIG,
  UI_EVENT_CAP,
  type LeakyBucketEvent,
  type LeakyBucketKpiSnapshot,
  type LeakyBucketPolicySnapshot,
  type LeakyBucketSimulationConfig,
  type PolicySyncStatus,
  type SimulationStatus,
} from "../types/leakyBucket";
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

type UseLeakyBucketSimulationValue = {
  status: SimulationStatus;
  config: LeakyBucketSimulationConfig;
  events: LeakyBucketEvent[];
  kpi: LeakyBucketKpiSnapshot;
  session: SimulationSession | null;
  activePolicy: LeakyBucketPolicySnapshot | null;
  policySyncStatus: PolicySyncStatus;
  policySyncMessage: string | null;
  updateConfig: (next: Partial<LeakyBucketSimulationConfig>) => void;
  reloadActivePolicy: () => Promise<void>;
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  resetView: () => void;
};

const INITIAL_KPI: LeakyBucketKpiSnapshot = {
  total: 0,
  allowed: 0,
  rejected: 0,
  allowRate: 0,
  rejectRate: 0,
  currentWaterLevel: null,
  currentCapacity: DEFAULT_LEAKY_BUCKET_CONFIG.capacity,
  currentLeakRatePerSec: DEFAULT_LEAKY_BUCKET_CONFIG.leakRatePerSec,
  currentWaterPerRequest: DEFAULT_LEAKY_BUCKET_CONFIG.waterPerRequest,
  currentHeadroom: null,
  observedRps: 0,
  lastRetryAfterMs: null,
};

const safeNumber = (value: number, min: number): number => {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, value);
};

const clampConfig = (config: LeakyBucketSimulationConfig): LeakyBucketSimulationConfig => ({
  capacity: Math.floor(safeNumber(config.capacity, 1)),
  leakRatePerSec: safeNumber(config.leakRatePerSec, 0.01),
  waterPerRequest: Math.floor(safeNumber(config.waterPerRequest, 1)),
  rps: Math.floor(safeNumber(config.rps, 1)),
  durationSec: Math.floor(safeNumber(config.durationSec, 1)),
  concurrency: Math.floor(safeNumber(config.concurrency, 1)),
  clientIdMode: config.clientIdMode,
  singleClientId: config.singleClientId.trim() || "client-a",
  rotatingPoolSize: Math.floor(safeNumber(config.rotatingPoolSize, 2)),
});

const deriveKpi = (events: LeakyBucketEvent[], fallbackConfig: LeakyBucketSimulationConfig): LeakyBucketKpiSnapshot => {
  const { total, allowed, rejected, allowRate, rejectRate, latestDecision, lastRetryAfterMs, observedRps, state } =
    deriveBaseKpiStats(events);
  const fallbackHeadroom = state
    ? Math.max(0, Math.floor((state.capacity - state.waterLevel) / state.waterPerRequest))
    : null;

  return {
    total,
    allowed,
    rejected,
    allowRate,
    rejectRate,
    currentWaterLevel: state?.waterLevel ?? null,
    currentCapacity: state?.capacity ?? fallbackConfig.capacity,
    currentLeakRatePerSec: state?.leakRatePerSec ?? fallbackConfig.leakRatePerSec,
    currentWaterPerRequest: state?.waterPerRequest ?? fallbackConfig.waterPerRequest,
    currentHeadroom: latestDecision?.remaining ?? fallbackHeadroom,
    observedRps,
    lastRetryAfterMs,
  };
};

export const useLeakyBucketSimulation = (): UseLeakyBucketSimulationValue => {
  const [status, setStatus] = useState<SimulationStatus>("idle");
  const [config, setConfig] = useState<LeakyBucketSimulationConfig>(DEFAULT_LEAKY_BUCKET_CONFIG);
  const [events, setEvents] = useState<LeakyBucketEvent[]>([]);
  const [session, setSession] = useState<SimulationSession | null>(null);
  const [activePolicy, setActivePolicy] = useState<LeakyBucketPolicySnapshot | null>(null);
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

  const appendEvent = useCallback((event: LeakyBucketEvent) => {
    setEvents((previous) => {
      const next = [...previous, event];
      if (next.length <= UI_EVENT_CAP) {
        return next;
      }
      return next.slice(next.length - UI_EVENT_CAP);
    });
  }, []);

  const appendSyntheticError = useCallback(
    (message: string) => {
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
    },
    [appendEvent],
  );

  const reloadActivePolicy = useCallback(async () => {
    await reloadPolicyFromBackend({
      mountedRef,
      setPolicySyncStatus,
      setPolicySyncMessage,
      setActivePolicy,
      setConfig,
      fetchActivePolicy: fetchActiveLeakyBucketPolicy,
      applyLoadedPolicyToConfig: (previous, backendPolicy) =>
        clampConfig({
          ...previous,
          capacity: backendPolicy.capacity,
          leakRatePerSec: backendPolicy.leakRatePerSec,
          waterPerRequest: backendPolicy.waterPerRequest,
        }),
      loadedMessage: (backendPolicy) =>
        `Loaded active policy ${backendPolicy.name} (capacity=${backendPolicy.capacity}, leak=${backendPolicy.leakRatePerSec}/s, water_per_request=${backendPolicy.waterPerRequest}).`,
      emptyMessage: "No active leaky bucket policy found. Start will create or reuse one.",
    });
  }, []);

  useEffect(() => {
    void reloadActivePolicy();
  }, [reloadActivePolicy]);

  const resolveClientId = useCallback((resolvedConfig: LeakyBucketSimulationConfig): string => {
    return resolveSimulationClientId(runtimeRef.current, resolvedConfig);
  }, []);

  const dispatchRequest = useCallback(
    async (resolvedConfig: LeakyBucketSimulationConfig) => {
      const clientId = resolveClientId(resolvedConfig);
      const result = await simulateLeakyBucketRequest({ clientId });
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
        syncingMessage: "Syncing frontend leaky-bucket config to backend policy...",
        syncPolicy: (currentConfig) =>
          syncLeakyBucketPolicyConfig({
            capacity: currentConfig.capacity,
            leakRatePerSec: currentConfig.leakRatePerSec,
            waterPerRequest: currentConfig.waterPerRequest,
            resetRuntimeState: true,
          }),
        applySyncedPolicyToConfig: (currentConfig, syncedPolicy) =>
          clampConfig({
            ...currentConfig,
            capacity: syncedPolicy.capacity,
            leakRatePerSec: syncedPolicy.leakRatePerSec,
            waterPerRequest: syncedPolicy.waterPerRequest,
          }),
        syncedMessage: (syncedPolicy) =>
          `Synced and activated policy ${syncedPolicy.name} (capacity=${syncedPolicy.capacity}, leak=${syncedPolicy.leakRatePerSec}/s, water_per_request=${syncedPolicy.waterPerRequest}).`,
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
        config: resolvedConfig,
        dispatch: () => dispatchRequest(resolvedConfig),
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

  const updateConfig = useCallback((next: Partial<LeakyBucketSimulationConfig>) => {
    setConfig((previous) => clampConfig({ ...previous, ...next }));
  }, []);

  const kpi = useMemo(() => {
    if (events.length === 0) {
      return {
        ...INITIAL_KPI,
        currentCapacity: config.capacity,
        currentLeakRatePerSec: config.leakRatePerSec,
        currentWaterPerRequest: config.waterPerRequest,
      };
    }
    return deriveKpi(events, config);
  }, [events, config]);

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
