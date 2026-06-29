"""Barcodes — additive to 002/008 (T010).

Creates the `item_barcode` table (globally-unique barcode → item, optional unit). No 001–009 table is
dropped or redefined; no backfill.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

import src.models  # noqa: F401  (populate metadata)

revision = "0009_barcodes"
down_revision = "0008_serials"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "item_barcode",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("item_id", sa.BigInteger(), nullable=False),
        sa.Column("barcode", sa.String(length=64), nullable=False),
        sa.Column("unit", sa.String(length=16), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("barcode", name="uq_item_barcode_barcode"),
        sa.ForeignKeyConstraint(["item_id"], ["item.id"], name="fk_item_barcode_item"),
    )
    op.create_index("ix_item_barcode_item_id", "item_barcode", ["item_id"])


def downgrade() -> None:
    op.drop_index("ix_item_barcode_item_id", table_name="item_barcode")
    op.drop_table("item_barcode")
