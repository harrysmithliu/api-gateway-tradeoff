import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  activatePolicy,
  completeRun,
  createPolicy,
  createRun,
  getActivePolicy,
  getLogs,
  getMetricsSummary,
  getMetricsTimeseries,
  listPolicies,
  listRuns,
  simulateBurst,
  simulateOneRequest,
  updatePolicy,
} from "../api/gateway";
import { ApiError, getApiBaseUrl } from "../api/client";
import { KpiCards } from "../components/KpiCards";
import { LogTable } from "../components/LogTable";
import { PolicyPanel } from "../components/PolicyPanel";
import { SimulationPanel } from "../components/SimulationPanel";
import {
  DEFAULT_PARAMS_BY_ALGORITHM,
  PARAM_KEYS_BY_ALGORITHM,
  type ExperimentRun,
  type Policy,
  type PolicyDraft,
  type SimulateDecision,
  type SimulationConfig,
  type TimeseriesPoint,
} from "../types";

const DEFAULT_DRAFT: PolicyDraft = {
  id: null,
  name: "",
  algorithm: "fixed_window",
  params_json: { ...DEFAULT_PARAMS_BY_ALGORITHM.fixed_window },
  enabled: true,
  description: "",
};

const ComparisonChart = lazy(async () =>
  import("../components/ComparisonChart").then((module) => ({ default: module.ComparisonChart })),
);

const DEFAULT_SIMULATION_CONFIG: SimulationConfig = {
  mode: "request_loop",
  rounds: 5,
  requestsPerRound: 20,
  roundIntervalMs: 500,
  concurrency: 5,
  clientIdMode: "single",
  singleClientId: "client-a",
  rotatingPoolSize: 10,
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeDraft = (draft: PolicyDraft): PolicyDraft => {
  const defaults = DEFAULT_PARAMS_BY_ALGORITHM[draft.algorithm];
  const paramKeys = PARAM_KEYS_BY_ALGORITHM[draft.algorithm];
  const normalizedParams = paramKeys.reduce<Record<string, number>>((acc, key) => {
    const value = draft.params_json[key];
    acc[key] = typeof value === "number" ? value : defaults[key];
    return acc;
  }, {});

  return {
    ...draft,
    params_json: normalizedParams,
  };
};

const toDraft = (policy: Policy): PolicyDraft => ({
  id: policy.id,
  name: policy.name,
  algorithm: policy.algorithm,
  params_json: { ...policy.params_json },
  enabled: policy.enabled,
  description: policy.description ?? "",
});

const runPromisePool = async <T,>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>) => {
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;

  await Promise.all(
    Array.from({ length: workerCount }).map(async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        // eslint-disable-next-line no-await-in-loop
        await worker(items[index], index);
      }
    }),
  );
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof ApiError) {
    return `${error.message} (HTTP ${error.status})`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected error.";
};

export function Dashboard() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [activePolicy, setActivePolicy] = useState<Policy | null>(null);
  const [draft, setDraft] = useState<PolicyDraft>(DEFAULT_DRAFT);
  const [isSaving, setIsSaving] = useState(false);
  const [isActivating, setIsActivating] = useState(false);

  const [simulationConfig, setSimulationConfig] = useState<SimulationConfig>(DEFAULT_SIMULATION_CONFIG);
  const [simulationStatus, setSimulationStatus] = useState<"idle" | "running" | "paused">("idle");
  const [progressText, setProgressText] = useState("No simulation started.");

  const [runs, setRuns] = useState<ExperimentRun[]>([]);
  const [currentRun, setCurrentRun] = useState<ExperimentRun | null>(null);
  const [metricsScope, setMetricsScope] = useState<"global" | "current_run">("global");

  const [summary, setSummary] = useState<Awaited<ReturnType<typeof getMetricsSummary>> | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesPoint[]>([]);
  const [windowSec, setWindowSec] = useState(120);

  const [logs, setLogs] = useState<SimulateDecision[]>([]);
  const [rejectedOnly, setRejectedOnly] = useState(false);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const pollingCursorRef = useRef(0);
  const simulationControlRef = useRef({ stop: false, pause: false });

  const scopedRunId = metricsScope === "current_run" ? currentRun?.id : undefined;

  const policiesById = useMemo(() => {
    return policies.reduce<Record<string, Policy>>((acc, policy) => {
      acc[policy.id] = policy;
      return acc;
    }, {});
  }, [policies]);

  const loadPolicies = useCallback(async () => {
    const [policiesResult, activeResult] = await Promise.allSettled([listPolicies(), getActivePolicy()]);

    if (policiesResult.status === "fulfilled") {
      setPolicies(policiesResult.value);
      if (!draft.id && policiesResult.value[0]) {
        setDraft(toDraft(policiesResult.value[0]));
      }
    } else {
      setInfoMessage(`Policy list load failed: ${getErrorMessage(policiesResult.reason)}`);
    }

    if (activeResult.status === "fulfilled") {
      setActivePolicy(activeResult.value);
    } else if (activeResult.reason instanceof ApiError && activeResult.reason.status === 404) {
      setActivePolicy(null);
    } else {
      setInfoMessage(`Active policy load failed: ${getErrorMessage(activeResult.reason)}`);
    }
  }, [draft.id]);

  const loadRuns = useCallback(async () => {
    try {
      const runList = await listRuns();
      setRuns(runList);
      setCurrentRun((previous) => {
        if (!previous) {
          return previous;
        }
        return runList.find((run) => run.id === previous.id) ?? null;
      });
    } catch (error) {
      setInfoMessage(`Run list load failed: ${getErrorMessage(error)}`);
    }
  }, []);

  useEffect(() => {
    void loadPolicies();
    void loadRuns();
  }, [loadPolicies, loadRuns]);

  useEffect(() => {
    pollingCursorRef.current = 0;
    setLogs([]);
  }, [rejectedOnly, scopedRunId]);

  useEffect(() => {
    if (metricsScope === "current_run" && !scopedRunId) {
      setSummary(null);
      setTimeseries([]);
      return;
    }

    let cancelled = false;

    const pollMetrics = async () => {
      try {
        const [summaryData, timeseriesData] = await Promise.all([
          getMetricsSummary(windowSec, scopedRunId),
          getMetricsTimeseries(windowSec, 1, scopedRunId),
        ]);
        if (!cancelled) {
          setSummary(summaryData);
          setTimeseries(timeseriesData);
        }
      } catch (error) {
        if (!cancelled) {
          setInfoMessage(`Metrics polling failed: ${getErrorMessage(error)}`);
        }
      }
    };

    void pollMetrics();
    const timer = setInterval(() => {
      void pollMetrics();
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [windowSec, scopedRunId, metricsScope]);

  useEffect(() => {
    if (metricsScope === "current_run" && !scopedRunId) {
      setLogs([]);
      return;
    }

    let cancelled = false;

    const pollLogs = async () => {
      try {
        const payload = await getLogs(pollingCursorRef.current, 200, rejectedOnly, scopedRunId);
        if (cancelled) {
          return;
        }

        pollingCursorRef.current = payload.next_cursor;
        if (payload.items.length > 0) {
          setLogs((prev) => {
            const seen = new Set(prev.map((item) => item.request_id));
            const merged = [...prev];
            payload.items.forEach((item) => {
              if (!seen.has(item.request_id)) {
                merged.push(item);
                seen.add(item.request_id);
              }
            });
            return merged.slice(-1000);
          });
        }
      } catch (error) {
        if (!cancelled) {
          setInfoMessage(`Log polling failed: ${getErrorMessage(error)}`);
        }
      }
    };

    void pollLogs();
    const timer = setInterval(() => {
      void pollLogs();
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [rejectedOnly, scopedRunId, metricsScope]);

  const handleSelectPolicy = (policyId: string) => {
    const policy = policies.find((item) => item.id === policyId);
    if (!policy) {
      return;
    }
    setDraft(normalizeDraft(toDraft(policy)));
    setInfoMessage(null);
  };

  const handleDraftChange = (next: PolicyDraft) => {
    setDraft(normalizeDraft(next));
  };

  const handleSavePolicy = async () => {
    const normalized = normalizeDraft(draft);
    if (!normalized.name.trim()) {
      setInfoMessage("Policy name is required.");
      return;
    }

    setIsSaving(true);
    setInfoMessage(null);
    try {
      const saved = normalized.id ? await updatePolicy(normalized) : await createPolicy(normalized);
      await loadPolicies();
      setDraft(toDraft(saved));
      setInfoMessage(normalized.id ? "Policy updated." : "Policy created.");
    } catch (error) {
      setInfoMessage(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleActivatePolicy = async (resetRuntimeState: boolean) => {
    if (!draft.id) {
      setInfoMessage("Select an existing policy before activation.");
      return;
    }

    setIsActivating(true);
    setInfoMessage(null);
    try {
      const activated = await activatePolicy(draft.id, resetRuntimeState);
      setActivePolicy(activated);
      setInfoMessage(
        resetRuntimeState
          ? "Policy activated. Runtime state reset is not effective yet and will be supported soon."
          : "Policy activated.",
      );
    } catch (error) {
      setInfoMessage(getErrorMessage(error));
    } finally {
      setIsActivating(false);
    }
  };

  const finalizeRun = useCallback(async (runId: string, status: "completed" | "failed") => {
    try {
      const updated = await completeRun(runId, status);
      setCurrentRun(updated);
      await loadRuns();
    } catch {
      // Ignore completion failure to avoid masking simulation results.
    }
  }, [loadRuns]);

  const handlePauseToggle = () => {
    if (simulationStatus === "idle" || simulationConfig.mode === "burst_api") {
      return;
    }
    const shouldPause = simulationStatus === "running";
    simulationControlRef.current.pause = shouldPause;
    setSimulationStatus(shouldPause ? "paused" : "running");
  };

  const handleStop = () => {
    if (simulationStatus === "idle") {
      return;
    }
    simulationControlRef.current.stop = true;
    simulationControlRef.current.pause = false;
    if (simulationConfig.mode === "burst_api") {
      setProgressText("Stop requested. Current burst request cannot be interrupted.");
      return;
    }
    setProgressText("Stop requested. Finishing in-flight requests...");
  };

  const handleStart = async () => {
    if (simulationStatus === "running") {
      return;
    }

    if (!activePolicy) {
      setInfoMessage("Activate a policy before starting simulation.");
      return;
    }

    simulationControlRef.current.stop = false;
    simulationControlRef.current.pause = false;
    setSimulationStatus("running");
    setInfoMessage(null);

    const totalRequests = simulationConfig.mode === "burst_api"
      ? simulationConfig.requestsPerRound
      : simulationConfig.rounds * simulationConfig.requestsPerRound;

    setProgressText("Creating run...");

    const runName = `ui-run-${new Date().toISOString()}`;
    let run: ExperimentRun;

    try {
      run = await createRun({
        name: runName,
        policyId: activePolicy.id,
        scenario: {
          mode: simulationConfig.mode,
          rounds: simulationConfig.rounds,
          requests_per_round: simulationConfig.requestsPerRound,
          round_interval_ms: simulationConfig.roundIntervalMs,
          concurrency: simulationConfig.concurrency,
          client_id_mode: simulationConfig.clientIdMode,
          single_client_id: simulationConfig.singleClientId,
          rotating_pool_size: simulationConfig.rotatingPoolSize,
          total_requests: totalRequests,
        },
      });
    } catch (error) {
      setSimulationStatus("idle");
      setProgressText("Simulation aborted before start.");
      setInfoMessage(`Run creation failed: ${getErrorMessage(error)}`);
      return;
    }

    setCurrentRun(run);
    setMetricsScope("current_run");
    await loadRuns();

    let completed = 0;

    const waitWhilePaused = async () => {
      while (simulationControlRef.current.pause && !simulationControlRef.current.stop) {
        // eslint-disable-next-line no-await-in-loop
        await delay(150);
      }
    };

    try {
      if (simulationConfig.mode === "burst_api") {
        setProgressText("Executing burst request...");
        const result = await simulateBurst({
          totalRequests,
          clientIdMode: simulationConfig.clientIdMode,
          clientId: simulationConfig.singleClientId || "client-a",
          rotatePoolSize: simulationConfig.rotatingPoolSize,
          intervalMs: simulationConfig.roundIntervalMs,
          runId: run.id,
        });
        completed = result.total;
      } else {
        for (let roundIndex = 0; roundIndex < simulationConfig.rounds; roundIndex += 1) {
          if (simulationControlRef.current.stop) {
            break;
          }
          // eslint-disable-next-line no-await-in-loop
          await waitWhilePaused();

          const ids = Array.from({ length: simulationConfig.requestsPerRound }).map((_, requestIndex) => {
            const sequence = roundIndex * simulationConfig.requestsPerRound + requestIndex;
            if (simulationConfig.clientIdMode === "single") {
              return simulationConfig.singleClientId || "client-a";
            }
            const slot = (sequence % simulationConfig.rotatingPoolSize) + 1;
            return `client-${slot}`;
          });

          // eslint-disable-next-line no-await-in-loop
          await runPromisePool(ids, simulationConfig.concurrency, async (clientId) => {
            if (simulationControlRef.current.stop) {
              return;
            }
            await waitWhilePaused();

            await simulateOneRequest(clientId, run.id);
            completed += 1;
            setProgressText(`Completed ${completed}/${totalRequests} requests.`);
          });

          if (simulationConfig.roundIntervalMs > 0 && roundIndex < simulationConfig.rounds - 1) {
            // eslint-disable-next-line no-await-in-loop
            await delay(simulationConfig.roundIntervalMs);
          }
        }
      }

      const wasStopped = simulationControlRef.current.stop;
      await finalizeRun(run.id, wasStopped ? "failed" : "completed");

      setSimulationStatus("idle");
      if (wasStopped) {
        setProgressText(`Simulation stopped at ${completed}/${totalRequests} requests.`);
      } else {
        setProgressText(`Simulation completed: ${completed}/${totalRequests} requests.`);
      }
    } catch (error) {
      await finalizeRun(run.id, "failed");
      setSimulationStatus("idle");
      setProgressText("Simulation aborted due to an error.");
      setInfoMessage(`Simulation failed: ${getErrorMessage(error)}`);
    }
  };

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">API Gateway Tradeoff</p>
          <h1>Rate Limiter Dashboard</h1>
          <p className="subtle-line">Backend: {getApiBaseUrl()}</p>
        </div>
      </header>

      <PolicyPanel
        policies={policies}
        activePolicy={activePolicy}
        draft={draft}
        isSaving={isSaving}
        isActivating={isActivating}
        infoMessage={infoMessage}
        onSelectPolicy={handleSelectPolicy}
        onCreateDraft={() => setDraft(DEFAULT_DRAFT)}
        onDraftChange={handleDraftChange}
        onSavePolicy={handleSavePolicy}
        onActivatePolicy={handleActivatePolicy}
      />

      <SimulationPanel
        config={simulationConfig}
        status={simulationStatus}
        progressText={progressText}
        metricsScope={metricsScope}
        currentRun={currentRun}
        recentRuns={runs.slice(0, 30)}
        onConfigChange={setSimulationConfig}
        onMetricsScopeChange={setMetricsScope}
        onSelectRun={(runId) => {
          if (!runId) {
            setCurrentRun(null);
            return;
          }
          const selected = runs.find((item) => item.id === runId) ?? null;
          setCurrentRun(selected);
          setMetricsScope("current_run");
        }}
        onStart={() => {
          void handleStart();
        }}
        onPauseToggle={handlePauseToggle}
        onStop={handleStop}
        onResetCharts={() => {
          setTimeseries([]);
          setSummary(null);
        }}
      />

      <KpiCards summary={summary} />

      <Suspense
        fallback={
          <section className="card panel">
            <h2>Single-Panel Comparison</h2>
            <p className="meta-line">Loading chart module...</p>
          </section>
        }
      >
        <ComparisonChart points={timeseries} windowSec={windowSec} onWindowChange={setWindowSec} />
      </Suspense>

      <LogTable
        logs={logs}
        rejectedOnly={rejectedOnly}
        policiesById={policiesById}
        onRejectedOnlyChange={setRejectedOnly}
        onClear={() => setLogs([])}
      />
    </main>
  );
}
