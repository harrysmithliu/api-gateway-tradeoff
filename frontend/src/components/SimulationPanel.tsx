import type { ExperimentRun, SimulationConfig } from "../types";

type SimulationPanelProps = {
  config: SimulationConfig;
  status: "idle" | "running" | "paused";
  progressText: string;
  metricsScope: "global" | "current_run";
  currentRun: ExperimentRun | null;
  recentRuns: ExperimentRun[];
  onConfigChange: (next: SimulationConfig) => void;
  onMetricsScopeChange: (next: "global" | "current_run") => void;
  onSelectRun: (runId: string) => void;
  onStart: () => void;
  onPauseToggle: () => void;
  onStop: () => void;
  onResetCharts: () => void;
};

export function SimulationPanel({
  config,
  status,
  progressText,
  metricsScope,
  currentRun,
  recentRuns,
  onConfigChange,
  onMetricsScopeChange,
  onSelectRun,
  onStart,
  onPauseToggle,
  onStop,
  onResetCharts,
}: SimulationPanelProps) {
  return (
    <section className="card panel">
      <h2>Request Simulation</h2>

      <div className="grid five-col">
        <label>
          Execution Mode
          <select
            value={config.mode}
            onChange={(event) =>
              onConfigChange({
                ...config,
                mode: event.target.value as "request_loop" | "burst_api",
              })
            }
          >
            <option value="request_loop">Frontend Request Loop</option>
            <option value="burst_api">Backend Burst API</option>
          </select>
        </label>
        <label>
          Rounds
          <input
            type="number"
            min={1}
            value={config.rounds}
            onChange={(event) => onConfigChange({ ...config, rounds: Math.max(1, Number(event.target.value)) })}
            disabled={config.mode === "burst_api"}
          />
        </label>
        <label>
          Requests / Round
          <input
            type="number"
            min={1}
            value={config.requestsPerRound}
            onChange={(event) =>
              onConfigChange({ ...config, requestsPerRound: Math.max(1, Number(event.target.value)) })
            }
          />
        </label>
        <label>
          Round Interval (ms)
          <input
            type="number"
            min={0}
            value={config.roundIntervalMs}
            onChange={(event) =>
              onConfigChange({ ...config, roundIntervalMs: Math.max(0, Number(event.target.value)) })
            }
          />
        </label>
        <label>
          Concurrency
          <input
            type="number"
            min={1}
            value={config.concurrency}
            onChange={(event) => onConfigChange({ ...config, concurrency: Math.max(1, Number(event.target.value)) })}
            disabled={config.mode === "burst_api"}
          />
        </label>
      </div>

      <div className="grid five-col">
        <label>
          Client ID Mode
          <select
            value={config.clientIdMode}
            onChange={(event) =>
              onConfigChange({
                ...config,
                clientIdMode: event.target.value as "single" | "rotating",
              })
            }
          >
            <option value="single">Single</option>
            <option value="rotating">Rotating</option>
          </select>
        </label>
        <label>
          Single Client ID
          <input
            value={config.singleClientId}
            onChange={(event) => onConfigChange({ ...config, singleClientId: event.target.value })}
            disabled={config.clientIdMode !== "single"}
          />
        </label>
        <label>
          Rotating Pool Size
          <input
            type="number"
            min={2}
            value={config.rotatingPoolSize}
            onChange={(event) => onConfigChange({ ...config, rotatingPoolSize: Math.max(2, Number(event.target.value)) })}
            disabled={config.clientIdMode !== "rotating"}
          />
        </label>
        <label>
          Metrics / Logs Scope
          <select
            value={metricsScope}
            onChange={(event) => onMetricsScopeChange(event.target.value as "global" | "current_run")}
          >
            <option value="global">Global</option>
            <option value="current_run">Current Run</option>
          </select>
        </label>
        <label>
          Quick Select Run
          <select
            value={currentRun?.id ?? ""}
            onChange={(event) => onSelectRun(event.target.value)}
            disabled={recentRuns.length === 0}
          >
            <option value="">No run selected</option>
            {recentRuns.map((run) => (
              <option key={run.id} value={run.id}>
                {run.name} ({run.status})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="action-row">
        <button type="button" onClick={onStart} disabled={status === "running"}>
          Start
        </button>
        <button type="button" onClick={onPauseToggle} disabled={status === "idle" || config.mode === "burst_api"}>
          {status === "paused" ? "Resume" : "Pause"}
        </button>
        <button type="button" onClick={onStop} disabled={status === "idle"}>
          Stop
        </button>
        <button type="button" className="ghost-button" onClick={onResetCharts}>
          Reset Charts
        </button>
      </div>

      <p className="meta-line">
        Status: {status.toUpperCase()} | {progressText}
      </p>
      <p className="meta-line">Current run: {currentRun ? `${currentRun.name} (${currentRun.status})` : "Not attached"}</p>
    </section>
  );
}
