package db

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

func EnsureSchema(ctx context.Context, pool *pgxpool.Pool) error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS rate_limit_policies (
			id UUID PRIMARY KEY,
			name VARCHAR(128) UNIQUE NOT NULL,
			algorithm VARCHAR(32) NOT NULL,
			params_json JSONB NOT NULL,
			enabled BOOLEAN NOT NULL DEFAULT TRUE,
			version INT NOT NULL DEFAULT 1,
			description TEXT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			CONSTRAINT ck_rate_limit_policies_algorithm_supported
			CHECK (algorithm IN ('fixed_window', 'sliding_log', 'sliding_window_counter', 'token_bucket', 'leaky_bucket'))
		)`,
		`CREATE TABLE IF NOT EXISTS active_policy (
			id SMALLINT PRIMARY KEY DEFAULT 1,
			policy_id UUID NOT NULL REFERENCES rate_limit_policies(id) ON DELETE RESTRICT,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			CONSTRAINT ck_active_policy_single_row_id CHECK (id = 1)
		)`,
	}

	for _, stmt := range stmts {
		if _, err := pool.Exec(ctx, stmt); err != nil {
			return err
		}
	}
	return nil
}
