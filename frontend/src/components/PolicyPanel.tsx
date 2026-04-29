import { ALGORITHM_LABELS, PARAM_KEYS_BY_ALGORITHM, type AlgorithmType, type Policy, type PolicyDraft } from "../types";

type PolicyPanelProps = {
  policies: Policy[];
  activePolicy: Policy | null;
  draft: PolicyDraft;
  isSaving: boolean;
  isActivating: boolean;
  infoMessage: string | null;
  onSelectPolicy: (policyId: string) => void;
  onCreateDraft: () => void;
  onDraftChange: (next: PolicyDraft) => void;
  onSavePolicy: () => void;
  onActivatePolicy: (resetRuntimeState: boolean) => void;
};

const formatParamLabel = (value: string): string =>
  value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export function PolicyPanel({
  policies,
  activePolicy,
  draft,
  isSaving,
  isActivating,
  infoMessage,
  onSelectPolicy,
  onCreateDraft,
  onDraftChange,
  onSavePolicy,
  onActivatePolicy,
}: PolicyPanelProps) {
  const paramKeys = PARAM_KEYS_BY_ALGORITHM[draft.algorithm];

  return (
    <section className="card panel">
      <div className="panel-header">
        <h2>Policy Control</h2>
        <button type="button" className="ghost-button" onClick={onCreateDraft}>
          New Draft
        </button>
      </div>

      <div className="grid two-col">
        <label>
          Policy
          <select
            value={draft.id ?? ""}
            onChange={(event) => {
              if (!event.target.value) {
                return;
              }
              onSelectPolicy(event.target.value);
            }}
          >
            <option value="" disabled>
              Select existing policy
            </option>
            {policies.map((policy) => (
              <option key={policy.id} value={policy.id}>
                {policy.name} ({ALGORITHM_LABELS[policy.algorithm]})
              </option>
            ))}
          </select>
        </label>

        <label>
          Algorithm
          <select
            value={draft.algorithm}
            onChange={(event) => {
              const algorithm = event.target.value as AlgorithmType;
              onDraftChange({ ...draft, algorithm, params_json: {} });
            }}
          >
            {Object.entries(ALGORITHM_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid two-col">
        <label>
          Name
          <input
            value={draft.name}
            onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
            placeholder="token-default"
          />
        </label>

        <label>
          Enabled
          <select
            value={draft.enabled ? "true" : "false"}
            onChange={(event) => onDraftChange({ ...draft, enabled: event.target.value === "true" })}
          >
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </label>
      </div>

      <label>
        Description
        <input
          value={draft.description}
          onChange={(event) => onDraftChange({ ...draft, description: event.target.value })}
          placeholder="Policy notes"
        />
      </label>

      <div className="params-grid">
        {paramKeys.map((key) => (
          <label key={key}>
            {formatParamLabel(key)}
            <input
              type="number"
              min={0}
              step={key.includes("rate") ? "0.1" : "1"}
              value={draft.params_json[key] ?? ""}
              onChange={(event) => {
                const value = Number(event.target.value);
                onDraftChange({
                  ...draft,
                  params_json: {
                    ...draft.params_json,
                    [key]: Number.isNaN(value) ? 0 : value,
                  },
                });
              }}
            />
          </label>
        ))}
      </div>

      <div className="action-row">
        <button type="button" onClick={onSavePolicy} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Policy"}
        </button>
        <button type="button" onClick={() => onActivatePolicy(false)} disabled={isActivating || !draft.id}>
          {isActivating ? "Activating..." : "Activate Policy"}
        </button>
        <button
          type="button"
          className="warning"
          onClick={() => onActivatePolicy(true)}
          disabled={isActivating || !draft.id}
          title="Backend runtime key cleanup is not available yet."
        >
          Activate + Reset Runtime State (Not effective yet / Coming soon)
        </button>
      </div>

      <p className="meta-line">
        Active: {activePolicy ? `${activePolicy.name} (${ALGORITHM_LABELS[activePolicy.algorithm]})` : "No active policy"}
      </p>
      {infoMessage && <p className="info-line">{infoMessage}</p>}
    </section>
  );
}
