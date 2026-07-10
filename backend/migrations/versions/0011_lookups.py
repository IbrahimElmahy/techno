"""Configurable dropdown lists (lookups) — additive (013-settings-lookups).

Creates `lookup_option`. Options are lazily seeded by the service on first read, so no data
migration is needed here.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

import src.models  # noqa: F401  (populate metadata)

revision = "0011_lookups"
down_revision = "0010_manufacturing_bom"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lookup_option",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("category", sa.String(length=48), nullable=False),
        sa.Column("value", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=160), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("category", "value", name="uq_lookup_category_value"),
    )
    op.create_index("ix_lookup_option_category", "lookup_option", ["category"])


def downgrade() -> None:
    op.drop_index("ix_lookup_option_category", table_name="lookup_option")
    op.drop_table("lookup_option")
