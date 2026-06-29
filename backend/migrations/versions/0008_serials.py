"""Serial numbers — additive to 002/008 (T016).

Adds `item.is_serialized` and creates the `item_serial` registry. No 001–008 table is dropped or
redefined; no backfill (existing items: is_serialized false).
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

import src.models  # noqa: F401  (populate metadata)

revision = "0008_serials"
down_revision = "0007_item_units"
branch_labels = None
depends_on = None

_STATUS = sa.Enum("in_stock", "sold", name="serialstatus")


def upgrade() -> None:
    op.add_column(
        "item",
        sa.Column("is_serialized", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "item_serial",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("item_id", sa.BigInteger(), nullable=False),
        sa.Column("serial", sa.String(length=64), nullable=False),
        sa.Column("status", _STATUS, nullable=False),
        sa.Column("location_kind", sa.Enum("warehouse", "custody", name="locationkind"), nullable=True),
        sa.Column("location_id", sa.BigInteger(), nullable=True),
        sa.Column("sold_invoice_id", sa.BigInteger(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("item_id", "serial", name="uq_item_serial_item_serial"),
        sa.ForeignKeyConstraint(["item_id"], ["item.id"], name="fk_item_serial_item"),
        sa.ForeignKeyConstraint(["sold_invoice_id"], ["sales_invoice.id"], name="fk_item_serial_invoice"),
    )
    op.create_index("ix_item_serial_item_id", "item_serial", ["item_id"])


def downgrade() -> None:
    op.drop_index("ix_item_serial_item_id", table_name="item_serial")
    op.drop_table("item_serial")
    op.drop_column("item", "is_serialized")
