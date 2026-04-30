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
			policy_id UUID NULL,
			active_algorithm VARCHAR(32) NOT NULL,
			active_policy_id UUID NOT NULL REFERENCES rate_limit_policies(id) ON DELETE RESTRICT,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			CONSTRAINT ck_active_policy_single_row_id CHECK (id = 1)
		)`,
		`ALTER TABLE active_policy ADD COLUMN IF NOT EXISTS policy_id UUID`,
		`ALTER TABLE active_policy ADD COLUMN IF NOT EXISTS active_algorithm VARCHAR(32)`,
		`ALTER TABLE active_policy ADD COLUMN IF NOT EXISTS active_policy_id UUID`,
		`DO $$
		BEGIN
			IF EXISTS (
				SELECT 1 FROM information_schema.columns
				WHERE table_name = 'active_policy' AND column_name = 'policy_id'
			) THEN
				EXECUTE '
					UPDATE active_policy ap
					SET
						active_policy_id = ap.policy_id,
						active_algorithm = p.algorithm
					FROM rate_limit_policies p
					WHERE ap.policy_id = p.id
						AND (ap.active_policy_id IS NULL OR ap.active_algorithm IS NULL)
				';
			END IF;

			IF EXISTS (
				SELECT 1 FROM information_schema.columns
				WHERE table_name = 'active_policy' AND column_name = 'policy_id'
			) THEN
				EXECUTE '
					UPDATE active_policy
					SET policy_id = active_policy_id
					WHERE policy_id IS NULL AND active_policy_id IS NOT NULL
				';
			END IF;
		END $$`,
		`ALTER TABLE active_policy ALTER COLUMN active_algorithm SET NOT NULL`,
		`ALTER TABLE active_policy ALTER COLUMN active_policy_id SET NOT NULL`,
		`DO $$
		BEGIN
			IF NOT EXISTS (
				SELECT 1
				FROM pg_constraint
				WHERE conname = 'fk_active_policy_policy_id'
			) THEN
				ALTER TABLE active_policy
				ADD CONSTRAINT fk_active_policy_policy_id
				FOREIGN KEY (active_policy_id)
				REFERENCES rate_limit_policies(id)
				ON DELETE RESTRICT;
			END IF;
		END $$`,
		`DO $$
		BEGIN
			IF NOT EXISTS (
				SELECT 1
				FROM pg_constraint
				WHERE conname = 'ck_active_policy_algorithm_supported'
			) THEN
				ALTER TABLE active_policy
				ADD CONSTRAINT ck_active_policy_algorithm_supported
				CHECK (active_algorithm IN ('fixed_window', 'sliding_log', 'sliding_window_counter', 'token_bucket', 'leaky_bucket'));
			END IF;
		END $$`,
	}

	for _, stmt := range stmts {
		if _, err := pool.Exec(ctx, stmt); err != nil {
			return err
		}
	}
	return nil
}
