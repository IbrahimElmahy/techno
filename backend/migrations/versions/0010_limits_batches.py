"""Stock min/max limits + expiry batches — additive to 002/008 (T019).

Adds advisory `item.min_stock`/`item.max_stock` and `item.is_perishable`, and creates the
`stock_batch` table (perishable on-hand partitioned by expiry, FEFO). No 001–010 table is dropped or
redefined; no backfill (existing items: is_perishable false, limits null).
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

import src.models  # noqa: F401  (populate metadata)

revision = "0010_limits_batches"
down_revision = "0009_barcodes"
branch_labels = None
depends_on = None

_QTY = sa.Numeric(18, 3)


def upgrade() -> None:
    op.add_column("item", sa.Column("min_stock", _QTY, nullable=True))
    op.add_column("item", sa.Column("max_stock", _QTY, nullable=True))
    op.add_column(
        "item",
        sa.Column("is_perishable", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "stock_batch",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("item_id", sa.BigInteger(), nullable=False),
        sa.Column("location_kind", sa.Enum("warehouse", "custody", name="locationkind"),
                  nullable=False),
        sa.Column("location_id", sa.BigInteger(), nullable=False),
        sa.Column("expiry_date", sa.Date(), nullable=False),
        sa.Column("quantity", _QTY, nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["item_id"], ["item.id"], name="fk_stock_batch_item"),
    )
    op.create_index("ix_stock_batch_item_id", "stock_batch", ["item_id"])
    op.create_index(
        "ix_stock_batch_item_loc_exp", "stock_batch",
        ["item_id", "location_kind", "location_id", "expiry_date"],
    )


def downgrade() -> None:
    op.drop_index("ix_stock_batch_item_loc_exp", table_name="stock_batch")
    op.drop_index("ix_stock_batch_item_id", table_name="stock_batch")
    op.drop_table("stock_batch")
    op.drop_column("item", "is_perishable")
    op.drop_column("item", "max_stock")
    op.drop_column("item", "min_stock")
