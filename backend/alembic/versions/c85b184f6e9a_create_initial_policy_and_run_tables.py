"""create initial policy and run tables

Revision ID: c85b184f6e9a
Revises: 
Create Date: 2026-04-29 12:45:48.297899

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c85b184f6e9a'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "rate_limit_policies",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("algorithm", sa.String(length=32), nullable=False),
        sa.Column("params_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "algorithm IN ('fixed_window', 'sliding_log', 'sliding_window_counter', 'token_bucket', 'leaky_bucket')",
            name=op.f("ck_rate_limit_policies_algorithm_supported"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_rate_limit_policies"),
        sa.UniqueConstraint("name", name="uq_rate_limit_policies_name"),
    )

    op.create_table(
        "active_policy",
        sa.Column("id", sa.SmallInteger(), server_default=sa.text("1"), nullable=False),
        sa.Column("policy_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("id = 1", name=op.f("ck_active_policy_single_row_id")),
        sa.ForeignKeyConstraint(
            ["policy_id"],
            ["rate_limit_policies.id"],
            name="fk_active_policy_policy_id_rate_limit_policies",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_active_policy"),
    )

    op.create_table(
        "experiment_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("policy_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("scenario_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=16), server_default=sa.text("'running'"), nullable=False),
        sa.CheckConstraint(
            "status IN ('running', 'completed', 'failed')",
            name=op.f("ck_experiment_runs_status_supported"),
        ),
        sa.ForeignKeyConstraint(
            ["policy_id"],
            ["rate_limit_policies.id"],
            name="fk_experiment_runs_policy_id_rate_limit_policies",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_experiment_runs"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("experiment_runs")
    op.drop_table("active_policy")
    op.drop_table("rate_limit_policies")
