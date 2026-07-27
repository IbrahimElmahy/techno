"""Advisory min/max stock limits and expiry batches — 011.

Two planning tools the client had in their old system and would otherwise lose: min/max thresholds
that drive a reorder report, and expiry-date batches with FEFO consumption plus an expiring-soon
report. Both are additive - existing items keep null limits and are not perishable, so nothing
about how they already trade changes.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0029_stock_limits_batches"
down_revision = "0028_invoice_parity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("item", sa.Column("min_stock", sa.Numeric(18, 3), nullable=True))
    op.add_column("item", sa.Column("max_stock", sa.Numeric(18, 3), nullable=True))
    op.add_column("item", sa.Column("is_perishable", sa.Boolean(), nullable=False,
                                    server_default=sa.false()))

    op.create_table(
        "stock_batch",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("item_id", sa.BigInteger(), sa.ForeignKey("item.id"), nullable=False),
        sa.Column("location_kind", sa.String(20), nullable=False),
        sa.Column("location_id", sa.BigInteger(), nullable=False),
        sa.Column("expiry_date", sa.Date(), nullable=False),
        sa.Column("quantity", sa.Numeric(18, 3), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    # FEFO reads and the receive/return upsert both look up by this exact tuple.
    op.create_index("ix_stock_batch_lookup", "stock_batch",
                    ["item_id", "location_kind", "location_id", "expiry_date"])


def downgrade() -> None:
    op.drop_index("ix_stock_batch_lookup", table_name="stock_batch")
    op.drop_table("stock_batch")
    op.drop_column("item", "is_perishable")
    op.drop_column("item", "max_stock")
    op.drop_column("item", "min_stock")
