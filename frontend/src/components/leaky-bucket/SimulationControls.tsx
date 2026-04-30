import type { SimulationStatus, LeakyBucketSimulationConfig } from "../../types/leakyBucket";

type SimulationControlsProps = {
  config: LeakyBucketSimulationConfig;
  status: SimulationStatus;
  onUpdateConfig: (next: Partial<LeakyBucketSimulationConfig>) => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onResetView: () => void;
};

export function SimulationControls({
  config,
  status,
  onUpdateConfig,
  onStart,
  onPause,
  onResume,
  onStop,
  onResetView,
}: SimulationControlsProps) {
  const pauseResumeLabel = status === "paused" ? "Resume" : "Pause";

  return (
    <section className="card panel">
      <h2>Simulation Controls</h2>

      <div className="field-grid six-columns">
        <label>
          Capacity
          <input
            type="number"
            min={1}
            value={config.capacity}
            onChange={(event) => onUpdateConfig({ capacity: Number(event.target.value) })}
          />
        </label>
        <label>
          Leak Rate / sec
          <input
            type="number"
            min={0.01}
            step={0.1}
            value={config.leakRatePerSec}
            onChange={(event) => onUpdateConfig({ leakRatePerSec: Number(event.target.value) })}
          />
        </label>
        <label>
          Water / Request
          <input
            type="number"
            min={1}
            value={config.waterPerRequest}
            onChange={(event) => onUpdateConfig({ waterPerRequest: Number(event.target.value) })}
          />
        </label>
        <label>
          RPS
          <input type="number" min={1} value={config.rps} onChange={(event) => onUpdateConfig({ rps: Number(event.target.value) })} />
        </label>
        <label>
          Duration (sec)
          <input
            type="number"
            min={1}
            value={config.durationSec}
            onChange={(event) => onUpdateConfig({ durationSec: Number(event.target.value) })}
          />
        </label>
        <label>
          Concurrency
          <input
            type="number"
            min={1}
            value={config.concurrency}
            onChange={(event) => onUpdateConfig({ concurrency: Number(event.target.value) })}
          />
        </label>
      </div>

      <div className="field-grid two-columns">
        <label>
          Client ID Mode
          <select
            value={config.clientIdMode}
            onChange={(event) =>
              onUpdateConfig({
                clientIdMode: event.target.value as "single" | "rotating",
              })
            }
          >
            <option value="single">single</option>
            <option value="rotating">rotating</option>
          </select>
        </label>
        <label>
          Rotating Pool Size
          <input
            type="number"
            min={2}
            value={config.rotatingPoolSize}
            onChange={(event) => onUpdateConfig({ rotatingPoolSize: Number(event.target.value) })}
            disabled={config.clientIdMode !== "rotating"}
          />
        </label>
      </div>

      <div className="field-grid two-columns">
        <label>
          Single Client ID
          <input
            value={config.singleClientId}
            onChange={(event) => onUpdateConfig({ singleClientId: event.target.value })}
            disabled={config.clientIdMode !== "single"}
          />
        </label>
      </div>

      <div className="button-row">
        <button type="button" onClick={onStart} disabled={status !== "idle"}>
          Start
        </button>
        <button type="button" onClick={status === "paused" ? onResume : onPause} disabled={status === "idle" || status === "stopping"}>
          {pauseResumeLabel}
        </button>
        <button type="button" onClick={onStop} disabled={status === "idle" || status === "stopping"}>
          Stop
        </button>
        <button type="button" className="ghost" onClick={onResetView}>
          Reset View
        </button>
      </div>
    </section>
  );
}
