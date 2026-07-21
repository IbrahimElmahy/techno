"""Inspection point-items catalog (أصناف المعاينة) — 023.

A dedicated list of fitting types with loyalty points, separate from the sellable products;
seeded lazily from «حساب نقاط» on first read.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0023_inspection_item_types"
down_revision = "0022_inspection_customer"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "inspection_item_type",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(200), nullable=False, unique=True),
        sa.Column("points", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    op.drop_table("inspection_item_type")
