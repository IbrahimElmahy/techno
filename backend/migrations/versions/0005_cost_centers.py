"""Cost Centers — additive to 001/005 (T017).

Creates the `cost_center` master table and adds an optional `cost_center_id` dimension column to
`ledger_line`. No 001–005 table is dropped or redefined; no data backfill (existing lines stay NULL).
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

import src.models  # noqa: F401  (populate metadata)

revision = "0005_cost_centers"
down_revision = "0004_general_ledger"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cost_center",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("code", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("parent_id", sa.BigInteger(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code", name="uq_cost_center_code"),
        sa.ForeignKeyConstraint(["parent_id"], ["cost_center.id"], name="fk_cost_center_parent"),
    )
    op.create_index("ix_cost_center_parent_id", "cost_center", ["parent_id"])

    op.add_column("ledger_line", sa.Column("cost_center_id", sa.BigInteger(), nullable=True))
    op.create_index("ix_ledger_line_cost_center_id", "ledger_line", ["cost_center_id"])
    op.create_foreign_key(
        "fk_ledger_line_cost_center", "ledger_line", "cost_center", ["cost_center_id"], ["id"]
    )


def downgrade() -> None:
    op.drop_constraint("fk_ledger_line_cost_center", "ledger_line", type_="foreignkey")
    op.drop_index("ix_ledger_line_cost_center_id", table_name="ledger_line")
    op.drop_column("ledger_line", "cost_center_id")
    op.drop_index("ix_cost_center_parent_id", table_name="cost_center")
    op.drop_table("cost_center")
