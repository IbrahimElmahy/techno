"""Per-item default discount % (v4) — from the client's items workbook.

The source data carries a discount rate per item (0 / 5% / 10%); store it on the item as the
suggested line discount. Additive; existing rows default to 0.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0014_item_discount"
down_revision = "0013_v4_quick_wins"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("item", sa.Column("default_discount_pct", sa.Numeric(5, 2),
                                    nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("item", "default_discount_pct")
