"""Cash vouchers (018-finance-vouchers): سند قبض / سند صرف / توريد المندوب.

Closes the money cycle — receivables and payables can finally be settled without raw
journal entries. Each voucher owns one balanced ledger entry and reverses once.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0018_finance_vouchers"
down_revision = "0017_inspection_review"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "voucher",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("document_number", sa.String(24), nullable=False, unique=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("customer_id", sa.BigInteger(), sa.ForeignKey("customer.id"), nullable=True),
        sa.Column("supplier_id", sa.BigInteger(), sa.ForeignKey("supplier.id"), nullable=True),
        sa.Column("rep_user_id", sa.BigInteger(), sa.ForeignKey("user.id"), nullable=True),
        sa.Column("cash_account_id", sa.BigInteger(), sa.ForeignKey("account.id"),
                  nullable=False),
        sa.Column("party_account_id", sa.BigInteger(), sa.ForeignKey("account.id"),
                  nullable=False),
        sa.Column("voucher_date", sa.Date(), nullable=False),
        sa.Column("payment_method", sa.String(32), nullable=True),
        sa.Column("reference", sa.String(80), nullable=True),
        sa.Column("description", sa.String(255), nullable=True),
        sa.Column("ledger_entry_id", sa.BigInteger(), sa.ForeignKey("ledger_entry.id"),
                  nullable=True),
        sa.Column("reverses_id", sa.BigInteger(), sa.ForeignKey("voucher.id"), nullable=True,
                  unique=True),
        sa.Column("actor_user_id", sa.BigInteger(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_voucher_kind", "voucher", ["kind"])
    op.create_index("ix_voucher_customer_id", "voucher", ["customer_id"])
    op.create_index("ix_voucher_supplier_id", "voucher", ["supplier_id"])
    op.create_index("ix_voucher_rep_user_id", "voucher", ["rep_user_id"])


def downgrade() -> None:
    op.drop_table("voucher")
