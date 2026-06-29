"""Multiple units of measure — additive to 002/007 (T018).

Creates the `item_unit` table and adds `unit` / `unit_factor` columns to the sales and purchase invoice
line tables. No 001–007 table is dropped or redefined; no backfill (existing lines: unit NULL, factor 1).
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

import src.models  # noqa: F401  (populate metadata)

revision = "0007_item_units"
down_revision = "0006_price_tiers"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "item_unit",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("item_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=16), nullable=False),
        sa.Column("factor", sa.Numeric(18, 3), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("item_id", "name", name="uq_item_unit_item_name"),
        sa.ForeignKeyConstraint(["item_id"], ["item.id"], name="fk_item_unit_item"),
    )
    op.create_index("ix_item_unit_item_id", "item_unit", ["item_id"])

    for table in ("sales_invoice_line", "purchase_invoice_line"):
        op.add_column(table, sa.Column("unit", sa.String(length=16), nullable=True))
        op.add_column(
            table,
            sa.Column("unit_factor", sa.Numeric(18, 3), nullable=False, server_default="1"),
        )


def downgrade() -> None:
    for table in ("purchase_invoice_line", "sales_invoice_line"):
        op.drop_column(table, "unit_factor")
        op.drop_column(table, "unit")
    op.drop_index("ix_item_unit_item_id", table_name="item_unit")
    op.drop_table("item_unit")
