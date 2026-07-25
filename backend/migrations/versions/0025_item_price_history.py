"""Item price-change log — 027-item-360.

Posted documents already snapshot the price charged, but nothing recorded WHEN a reference
price changed or WHO changed it. Append-only; corrections are new rows.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0025_item_price_history"
down_revision = "0024_account_branch"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "item_price_history",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("item_id", sa.BigInteger(), sa.ForeignKey("item.id"), nullable=False,
                  index=True),
        sa.Column("field", sa.String(32), nullable=False),
        sa.Column("old_value", sa.Numeric(18, 2), nullable=True),
        sa.Column("new_value", sa.Numeric(18, 2), nullable=True),
        sa.Column("actor_user_id", sa.BigInteger(), sa.ForeignKey("user.id"), nullable=True),
        sa.Column("changed_at", sa.DateTime(), server_default=sa.func.now(), nullable=False,
                  index=True),
    )


def downgrade() -> None:
    op.drop_table("item_price_history")
