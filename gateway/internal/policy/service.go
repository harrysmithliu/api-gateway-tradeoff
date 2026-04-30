package policy

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"gateway/internal/runtime"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound                  = errors.New("not found")
	ErrConflict                  = errors.New("conflict")
	ErrInvalidInput              = errors.New("invalid input")
	ErrUnsupportedInCurrentPhase = errors.New("algorithm not available in current milestone")
	ErrUnsupportedInM1           = ErrUnsupportedInCurrentPhase
	ErrDisabledPolicy            = errors.New("disabled policy")
	ErrNoActivePolicy            = errors.New("no active policy")
	ErrActivePolicyMissing       = errors.New("active policy target missing")
)

type Service struct {
	pool  *pgxpool.Pool
	store runtime.Store
}

func NewService(pool *pgxpool.Pool, store runtime.Store) *Service {
	return &Service{pool: pool, store: store}
}

func (s *Service) List(ctx context.Context) ([]Policy, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, algorithm, params_json, enabled, version, description, created_at, updated_at
		FROM rate_limit_policies
		ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []Policy{}
	for rows.Next() {
		policy, err := scanPolicy(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, policy)
	}
	return items, rows.Err()
}

func (s *Service) Create(ctx context.Context, req CreateRequest) (Policy, error) {
	if err := validateAlgorithmForCurrentPhase(req.Algorithm); err != nil {
		return Policy{}, err
	}
	params, err := validateParams(req.Algorithm, req.ParamsJSON)
	if err != nil {
		return Policy{}, err
	}

	id := uuid.NewString()
	now := time.Now().UTC()
	paramsBytes, _ := json.Marshal(params)

	_, err = s.pool.Exec(ctx, `
		INSERT INTO rate_limit_policies (id, name, algorithm, params_json, enabled, version, description, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,1,$6,$7,$7)
	`, id, req.Name, req.Algorithm, paramsBytes, req.Enabled, req.Description, now)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") {
			return Policy{}, ErrConflict
		}
		return Policy{}, err
	}

	return s.GetByID(ctx, id)
}

func (s *Service) GetByID(ctx context.Context, id string) (Policy, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id, name, algorithm, params_json, enabled, version, description, created_at, updated_at
		FROM rate_limit_policies WHERE id = $1
	`, id)
	policy, err := scanPolicy(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Policy{}, ErrNotFound
		}
		return Policy{}, err
	}
	return policy, nil
}

func (s *Service) Update(ctx context.Context, id string, req UpdateRequest) (Policy, error) {
	current, err := s.GetByID(ctx, id)
	if err != nil {
		return Policy{}, err
	}

	algorithm := current.Algorithm
	if req.Algorithm != nil {
		algorithm = *req.Algorithm
	}
	if err := validateAlgorithmForCurrentPhase(algorithm); err != nil {
		return Policy{}, err
	}

	params := current.ParamsJSON
	if req.ParamsJSON != nil {
		params = *req.ParamsJSON
	}
	params, err = validateParams(algorithm, params)
	if err != nil {
		return Policy{}, err
	}

	name := current.Name
	if req.Name != nil {
		name = strings.TrimSpace(*req.Name)
		if name == "" {
			return Policy{}, ErrInvalidInput
		}
	}
	enabled := current.Enabled
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	description := current.Description
	if req.Description != nil {
		description = req.Description
	}

	paramsBytes, _ := json.Marshal(params)
	_, err = s.pool.Exec(ctx, `
		UPDATE rate_limit_policies
		SET name=$2, algorithm=$3, params_json=$4, enabled=$5, description=$6, version=version+1, updated_at=now()
		WHERE id=$1
	`, id, name, algorithm, paramsBytes, enabled, description)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") {
			return Policy{}, ErrConflict
		}
		return Policy{}, err
	}

	return s.GetByID(ctx, id)
}

func (s *Service) Activate(ctx context.Context, id string, resetRuntime bool) (Policy, error) {
	policy, err := s.GetByID(ctx, id)
	if err != nil {
		return Policy{}, err
	}
	if !policy.Enabled {
		return Policy{}, ErrDisabledPolicy
	}

	if resetRuntime {
		if err := s.store.ScanDelete(ctx, fmt.Sprintf("rl:*:%s:*", id), 500); err != nil {
			return Policy{}, err
		}
	}

	_, err = s.pool.Exec(ctx, `
		INSERT INTO active_policy (id, policy_id, active_algorithm, active_policy_id, updated_at)
		VALUES (1, $1, $2, $3, now())
		ON CONFLICT (id) DO UPDATE SET
			policy_id = EXCLUDED.policy_id,
			active_algorithm = EXCLUDED.active_algorithm,
			active_policy_id = EXCLUDED.active_policy_id,
			updated_at = now()
	`, id, policy.Algorithm, id)
	if err != nil {
		return Policy{}, err
	}
	return policy, nil
}

func (s *Service) Active(ctx context.Context) (Policy, error) {
	var activeAlgorithm, policyID string
	err := s.pool.QueryRow(ctx, `
		SELECT active_algorithm, active_policy_id
		FROM active_policy
		WHERE id = 1
	`).Scan(&activeAlgorithm, &policyID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Policy{}, ErrNoActivePolicy
		}
		return Policy{}, err
	}
	if strings.TrimSpace(activeAlgorithm) == "" || strings.TrimSpace(policyID) == "" {
		return Policy{}, ErrNoActivePolicy
	}

	policy, err := s.GetByID(ctx, policyID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return Policy{}, ErrActivePolicyMissing
		}
		return Policy{}, err
	}
	if policy.Algorithm != activeAlgorithm {
		return Policy{}, ErrActivePolicyMissing
	}
	return policy, nil
}

type scanner interface {
	Scan(dest ...any) error
}

func scanPolicy(row scanner) (Policy, error) {
	var item Policy
	var paramsRaw []byte
	err := row.Scan(&item.ID, &item.Name, &item.Algorithm, &paramsRaw, &item.Enabled, &item.Version, &item.Description, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		return Policy{}, err
	}
	if err := json.Unmarshal(paramsRaw, &item.ParamsJSON); err != nil {
		return Policy{}, err
	}
	return item, nil
}

func validateAlgorithmForCurrentPhase(algorithm string) error {
	if strings.TrimSpace(algorithm) == "" {
		return ErrInvalidInput
	}
	switch algorithm {
	case "fixed_window", "sliding_log", "sliding_window_counter", "token_bucket":
		return nil
	default:
		return ErrUnsupportedInCurrentPhase
	}
}

func validateParams(algorithm string, params map[string]any) (map[string]any, error) {
	switch algorithm {
	case "fixed_window", "sliding_log", "sliding_window_counter":
		return validateWindowAndLimit(params)
	case "token_bucket":
		return validateTokenBucketParams(params)
	default:
		return nil, ErrUnsupportedInCurrentPhase
	}
}

func validateWindowAndLimit(params map[string]any) (map[string]any, error) {
	window, ok := toPositiveInt(params["window_size_sec"])
	if !ok {
		return nil, fmt.Errorf("%w: window_size_sec must be > 0", ErrInvalidInput)
	}
	limit, ok := toPositiveInt(params["limit"])
	if !ok {
		return nil, fmt.Errorf("%w: limit must be > 0", ErrInvalidInput)
	}
	return map[string]any{"window_size_sec": window, "limit": limit}, nil
}

func validateTokenBucketParams(params map[string]any) (map[string]any, error) {
	capacity, ok := toPositiveInt(params["capacity"])
	if !ok {
		return nil, fmt.Errorf("%w: capacity must be > 0", ErrInvalidInput)
	}
	refillRate, ok := toPositiveFloat(params["refill_rate_per_sec"])
	if !ok {
		return nil, fmt.Errorf("%w: refill_rate_per_sec must be > 0", ErrInvalidInput)
	}
	tokensPerRequest := 1
	if raw, exists := params["tokens_per_request"]; exists {
		value, valid := toPositiveInt(raw)
		if !valid {
			return nil, fmt.Errorf("%w: tokens_per_request must be > 0", ErrInvalidInput)
		}
		tokensPerRequest = value
	}

	return map[string]any{
		"capacity":            capacity,
		"refill_rate_per_sec": refillRate,
		"tokens_per_request":  tokensPerRequest,
	}, nil
}

func toPositiveInt(value any) (int, bool) {
	switch v := value.(type) {
	case float64:
		if v > 0 {
			return int(v), true
		}
	case int:
		if v > 0 {
			return v, true
		}
	case int64:
		if v > 0 {
			return int(v), true
		}
	}
	return 0, false
}

func toPositiveFloat(value any) (float64, bool) {
	switch v := value.(type) {
	case float64:
		if v > 0 {
			return v, true
		}
	case int:
		if v > 0 {
			return float64(v), true
		}
	case int64:
		if v > 0 {
			return float64(v), true
		}
	}
	return 0, false
}
