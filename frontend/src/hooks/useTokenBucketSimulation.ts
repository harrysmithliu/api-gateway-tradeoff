import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchActiveTokenBucketPolicy,
  simulateTokenBucketRequest,
  syncTokenBucketPolicyConfig,
} from "../api/tokenBucketApi";
import {
  DEFAULT_TOKEN_BUCKET_CONFIG,
  UI_EVENT_CAP,
  type PolicySyncStatus,
  type SimulationStatus,
  type TokenBucketEvent,
  type TokenBucketKpiSnapshot,
  type TokenBucketPolicySnapshot,
  type TokenBucketSimulationConfig,
} from "../types/tokenBucket";
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

type UseTokenBucketSimulationValue = {
  status: SimulationStatus;
  config: TokenBucketSimulationConfig;
  events: TokenBucketEvent[];
  kpi: TokenBucketKpiSnapshot;
  session: SimulationSession | null;
  activePolicy: TokenBucketPolicySnapshot | null;
  policySyncStatus: PolicySyncStatus;
  policySyncMessage: string | null;
  updateConfig: (next: Partial<TokenBucketSimulationConfig>) => void;
  reloadActivePolicy: () => Promise<void>;
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  resetView: () => void;
};

const INITIAL_KPI: TokenBucketKpiSnapshot = {
  total: 0,
  allowed: 0,
  rejected: 0,
  allowRate: 0,
  rejectRate: 0,
  currentTokens: null,
  currentCapacity: DEFAULT_TOKEN_BUCKET_CONFIG.capacity,
  currentRefillRatePerSec: DEFAULT_TOKEN_BUCKET_CONFIG.refillRatePerSec,
  currentTokensPerRequest: DEFAULT_TOKEN_BUCKET_CONFIG.tokensPerRequest,
  currentRequestBudget: null,
  observedRps: 0,
  lastRetryAfterMs: null,
};

const safeNumber = (value: number, min: number): number => {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, value);
};

const clampConfig = (config: TokenBucketSimulationConfig): TokenBucketSimulationConfig => ({
  capacity: Math.floor(safeNumber(config.capacity, 1)),
  refillRatePerSec: safeNumber(config.refillRatePerSec, 0.01),
  tokensPerRequest: Math.floor(safeNumber(config.tokensPerRequest, 1)),
  rps: Math.floor(safeNumber(config.rps, 1)),
  durationSec: Math.floor(safeNumber(config.durationSec, 1)),
  concurrency: Math.floor(safeNumber(config.concurrency, 1)),
  clientIdMode: config.clientIdMode,
  singleClientId: config.singleClientId.trim() || "client-a",
  rotatingPoolSize: Math.floor(safeNumber(config.rotatingPoolSize, 2)),
});

const deriveKpi = (events: TokenBucketEvent[], fallbackConfig: TokenBucketSimulationConfig): TokenBucketKpiSnapshot => {
  const { total, allowed, rejected, allowRate, rejectRate, latestDecision, lastRetryAfterMs, observedRps, state } =
    deriveBaseKpiStats(events);

  return {
    total,
    allowed,
    rejected,
    allowRate,
    rejectRate,
    currentTokens: state?.tokens ?? null,
    currentCapacity: state?.capacity ?? fallbackConfig.capacity,
    currentRefillRatePerSec: state?.refillRatePerSec ?? fallbackConfig.refillRatePerSec,
    currentTokensPerRequest: state?.tokensPerRequest ?? fallbackConfig.tokensPerRequest,
    currentRequestBudget:
      latestDecision?.remaining ??
      (state ? Math.max(0, Math.floor(state.tokens / state.tokensPerRequest)) : null),
    observedRps,
    lastRetryAfterMs,
  };
};

export const useTokenBucketSimulation = (): UseTokenBucketSimulationValue => {
  const [status, setStatus] = useState<SimulationStatus>("idle");
  const [config, setConfig] = useState<TokenBucketSimulationConfig>(DEFAULT_TOKEN_BUCKET_CONFIG);
  const [events, setEvents] = useState<TokenBucketEvent[]>([]);
  const [session, setSession] = useState<SimulationSession | null>(null);
  const [activePolicy, setActivePolicy] = useState<TokenBucketPolicySnapshot | null>(null);
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

  const appendEvent = useCallback((event: TokenBucketEvent) => {
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
      fetchActivePolicy: fetchActiveTokenBucketPolicy,
      applyLoadedPolicyToConfig: (previous, backendPolicy) =>
        clampConfig({
          ...previous,
          capacity: backendPolicy.capacity,
          refillRatePerSec: backendPolicy.refillRatePerSec,
          tokensPerRequest: backendPolicy.tokensPerRequest,
        }),
      loadedMessage: (backendPolicy) =>
        `Loaded active policy ${backendPolicy.name} (capacity=${backendPolicy.capacity}, refill=${backendPolicy.refillRatePerSec}/s, tokens_per_request=${backendPolicy.tokensPerRequest}).`,
      emptyMessage: "No active token bucket policy found. Start will create or reuse one.",
    });
  }, []);

  useEffect(() => {
    void reloadActivePolicy();
  }, [reloadActivePolicy]);

  const resolveClientId = useCallback((resolvedConfig: TokenBucketSimulationConfig): string => {
    return resolveSimulationClientId(runtimeRef.current, resolvedConfig);
  }, []);

  const dispatchRequest = useCallback(
    async (resolvedConfig: TokenBucketSimulationConfig) => {
      const clientId = resolveClientId(resolvedConfig);
      const result = await simulateTokenBucketRequest({ clientId });
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
        syncingMessage: "Syncing frontend token-bucket config to backend policy...",
        syncPolicy: (currentConfig) =>
          syncTokenBucketPolicyConfig({
            capacity: currentConfig.capacity,
            refillRatePerSec: currentConfig.refillRatePerSec,
            tokensPerRequest: currentConfig.tokensPerRequest,
            resetRuntimeState: true,
          }),
        applySyncedPolicyToConfig: (currentConfig, syncedPolicy) =>
          clampConfig({
            ...currentConfig,
            capacity: syncedPolicy.capacity,
            refillRatePerSec: syncedPolicy.refillRatePerSec,
            tokensPerRequest: syncedPolicy.tokensPerRequest,
          }),
        syncedMessage: (syncedPolicy) =>
          `Synced and activated policy ${syncedPolicy.name} (capacity=${syncedPolicy.capacity}, refill=${syncedPolicy.refillRatePerSec}/s, tokens_per_request=${syncedPolicy.tokensPerRequest}).`,
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

  const updateConfig = useCallback((next: Partial<TokenBucketSimulationConfig>) => {
    setConfig((previous) => clampConfig({ ...previous, ...next }));
  }, []);

  const kpi = useMemo(() => {
    if (events.length === 0) {
      return {
        ...INITIAL_KPI,
        currentCapacity: config.capacity,
        currentRefillRatePerSec: config.refillRatePerSec,
        currentTokensPerRequest: config.tokensPerRequest,
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
