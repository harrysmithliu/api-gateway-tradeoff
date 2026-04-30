import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ApiError,
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

type RuntimeControl = {
  stopRequested: boolean;
  pauseRequested: boolean;
  dispatchSequence: number;
  inFlight: Set<Promise<void>>;
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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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

const createSessionId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}`;
};

const deriveKpi = (events: LeakyBucketEvent[], fallbackConfig: LeakyBucketSimulationConfig): LeakyBucketKpiSnapshot => {
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
  const fallbackHeadroom = state
    ? Math.max(0, Math.floor((state.capacity - state.waterLevel) / state.waterPerRequest))
    : null;

  return {
    total,
    allowed,
    rejected,
    allowRate: total > 0 ? allowed / total : 0,
    rejectRate: total > 0 ? rejected / total : 0,
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
    setPolicySyncStatus("loading");
    try {
      const backendPolicy = await fetchActiveLeakyBucketPolicy();
      if (!mountedRef.current) {
        return;
      }

      if (backendPolicy) {
        setActivePolicy(backendPolicy);
        setConfig((previous) =>
          clampConfig({
            ...previous,
            capacity: backendPolicy.capacity,
            leakRatePerSec: backendPolicy.leakRatePerSec,
            waterPerRequest: backendPolicy.waterPerRequest,
          }),
        );
        setPolicySyncStatus("ready");
        setPolicySyncMessage(
          `Loaded active policy ${backendPolicy.name} (capacity=${backendPolicy.capacity}, leak=${backendPolicy.leakRatePerSec}/s, water_per_request=${backendPolicy.waterPerRequest}).`,
        );
      } else {
        setActivePolicy(null);
        setPolicySyncStatus("ready");
        setPolicySyncMessage("No active leaky bucket policy found. Start will create or reuse one.");
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

  const resolveClientId = useCallback((resolvedConfig: LeakyBucketSimulationConfig): string => {
    const runtime = runtimeRef.current;
    if (resolvedConfig.clientIdMode === "single") {
      return resolvedConfig.singleClientId;
    }

    const poolIndex = runtime.dispatchSequence % resolvedConfig.rotatingPoolSize;
    runtime.dispatchSequence += 1;
    return `client-${poolIndex + 1}`;
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
      setPolicySyncStatus("syncing");
      setPolicySyncMessage("Syncing frontend leaky-bucket config to backend policy...");

      try {
        const syncedPolicy = await syncLeakyBucketPolicyConfig({
          capacity: resolvedConfig.capacity,
          leakRatePerSec: resolvedConfig.leakRatePerSec,
          waterPerRequest: resolvedConfig.waterPerRequest,
          resetRuntimeState: true,
        });
        if (!mountedRef.current) {
          return;
        }
        setActivePolicy(syncedPolicy);
        const nextConfig = clampConfig({
          ...resolvedConfig,
          capacity: syncedPolicy.capacity,
          leakRatePerSec: syncedPolicy.leakRatePerSec,
          waterPerRequest: syncedPolicy.waterPerRequest,
        });
        setConfig(nextConfig);
        setPolicySyncStatus("ready");
        setPolicySyncMessage(
          `Synced and activated policy ${syncedPolicy.name} (capacity=${syncedPolicy.capacity}, leak=${syncedPolicy.leakRatePerSec}/s, water_per_request=${syncedPolicy.waterPerRequest}).`,
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

      const simulationDeadline = Date.now() + resolvedConfig.durationSec * 1000;

      let requestBudget = 0;
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
        requestBudget += (elapsedMs / 1000) * resolvedConfig.rps;
        requestBudget = Math.min(requestBudget, resolvedConfig.rps * 2);

        let dispatched = false;
        while (
          requestBudget >= 1 &&
          runtimeRef.current.inFlight.size < resolvedConfig.concurrency &&
          !runtimeRef.current.stopRequested &&
          !runtimeRef.current.pauseRequested
        ) {
          requestBudget -= 1;
          dispatched = true;

          const task = dispatchRequest(resolvedConfig).finally(() => {
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
