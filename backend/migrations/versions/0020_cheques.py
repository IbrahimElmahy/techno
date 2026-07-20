"""Cheques (020-finance-reports).

Income statement, balance sheet and aging are derived from the existing ledger, so this
migration only adds the cheque register.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0020_cheques"
down_revision = "0019_treasuries_period_lock"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cheque",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("document_number", sa.String(24), nullable=False, unique=True),
        sa.Column("direction", sa.String(10), nullable=False),
        sa.Column("status", sa.String(10), nullable=False, server_default="pending"),
        sa.Column("cheque_number", sa.String(40), nullable=False),
        sa.Column("bank_name", sa.String(120), nullable=True),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("issue_date", sa.Date(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("customer_id", sa.BigInteger(), sa.ForeignKey("customer.id"), nullable=True),
        sa.Column("supplier_id", sa.BigInteger(), sa.ForeignKey("supplier.id"), nullable=True),
        sa.Column("treasury_id", sa.BigInteger(), sa.ForeignKey("treasury.id"), nullable=True),
        sa.Column("description", sa.String(255), nullable=True),
        sa.Column("register_entry_id", sa.BigInteger(), sa.ForeignKey("ledger_entry.id"),
                  nullable=True),
        sa.Column("settle_entry_id", sa.BigInteger(), sa.ForeignKey("ledger_entry.id"),
                  nullable=True),
        sa.Column("settled_on", sa.Date(), nullable=True),
        sa.Column("actor_user_id", sa.BigInteger(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    for col in ("direction", "status", "due_date", "customer_id", "supplier_id"):
        op.create_index(f"ix_cheque_{col}", "cheque", [col])


def downgrade() -> None:
    op.drop_table("cheque")
