"""Inspections deduct from the rep's custody (015 follow-up).

`inspection_item.stock_movement_id` links each line to the `inspection_out` movement posted
against the recording rep's custody (NULL when the rep holds no custody / line has no item).
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0016_inspection_custody"
down_revision = "0015_inspections"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "inspection_item",
        sa.Column("stock_movement_id", sa.BigInteger(),
                  sa.ForeignKey("stock_movement.id"), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("inspection_item", "stock_movement_id")
