"""Sub-treasuries, cash transfers, expense vouchers and the period lock (019).

`treasury` names each cash/bank location and owns its ledger account, so the old
single hard-coded safe becomes just the default row. `period_lock` closes the books
through a date — enforced inside ledger_service.post_entry.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0019_treasuries_period_lock"
down_revision = "0018_finance_vouchers"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "treasury",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("kind", sa.String(8), nullable=False, server_default="cash"),
        sa.Column("branch_id", sa.BigInteger(), sa.ForeignKey("branch.id"), nullable=True),
        sa.Column("account_id", sa.BigInteger(), sa.ForeignKey("account.id"), nullable=False,
                  unique=True),
        sa.Column("bank_name", sa.String(120), nullable=True),
        sa.Column("account_number", sa.String(60), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_treasury_branch_id", "treasury", ["branch_id"])

    op.create_table(
        "period_lock",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("locked_through", sa.Date(), nullable=False),
        sa.Column("note", sa.String(255), nullable=True),
        sa.Column("actor_user_id", sa.BigInteger(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )

    op.add_column("voucher", sa.Column("treasury_id", sa.BigInteger(),
                                       sa.ForeignKey("treasury.id"), nullable=True))
    op.add_column("voucher", sa.Column("to_treasury_id", sa.BigInteger(),
                                       sa.ForeignKey("treasury.id"), nullable=True))
    op.create_index("ix_voucher_treasury_id", "voucher", ["treasury_id"])


def downgrade() -> None:
    op.drop_index("ix_voucher_treasury_id", "voucher")
    op.drop_column("voucher", "to_treasury_id")
    op.drop_column("voucher", "treasury_id")
    op.drop_table("period_lock")
    op.drop_index("ix_treasury_branch_id", "treasury")
    op.drop_table("treasury")
