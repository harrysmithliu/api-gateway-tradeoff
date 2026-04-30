package limiter

type Decision struct {
	Allowed        bool           `json:"allowed"`
	Reason         *string        `json:"reason,omitempty"`
	Remaining      *int           `json:"remaining,omitempty"`
	RetryAfterMS   *int           `json:"retry_after_ms,omitempty"`
	AlgorithmState map[string]any `json:"algorithm_state,omitempty"`
}
