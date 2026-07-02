"""Customer credit limit & due-term — additive to 002 (T015).

Adds `customer.credit_limit` / `customer.max_due_term_days` and `sales_invoice.due_date`. No 001–011
table is dropped or redefined; no backfill (existing customers: null limits = unlimited).
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

import src.models  # noqa: F401  (populate metadata)

revision = "0011_credit_limits"
down_revision = "0010_limits_batches"
branch_labels = None
depends_on = None

_MONEY = sa.Numeric(18, 2)


def upgrade() -> None:
    op.add_column("customer", sa.Column("credit_limit", _MONEY, nullable=True))
    op.add_column("customer", sa.Column("max_due_term_days", sa.Integer(), nullable=True))
    op.add_column("sales_invoice", sa.Column("due_date", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("sales_invoice", "due_date")
    op.drop_column("customer", "max_due_term_days")
    op.drop_column("customer", "credit_limit")
