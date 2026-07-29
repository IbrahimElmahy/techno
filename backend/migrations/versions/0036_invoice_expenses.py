"""مصروفات الفاتورة — على العميل أو على الشركة (a5 parity).

Two kinds on purpose. A billed expense is freight the customer pays for and belongs inside what he
owes; an operating expense is one we bear on the sale and only reduces the profit. One column could
not hold both without making either his balance or the margin wrong.

Additive: an invoice with no expense lines and both totals at zero posts exactly as before.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0036_invoice_expenses"
down_revision = "0035_invoice_date"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sales_invoice_expense",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("invoice_id", sa.BigInteger(), sa.ForeignKey("sales_invoice.id"),
                  nullable=False),
        sa.Column("account_id", sa.BigInteger(), sa.ForeignKey("account.id"), nullable=False),
        sa.Column("kind", sa.Enum("billed", "operating", name="expensekind"), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("description", sa.String(240), nullable=True),
    )
    op.create_index("ix_sales_invoice_expense_invoice", "sales_invoice_expense", ["invoice_id"])

    op.add_column("sales_invoice", sa.Column("expenses_billed", sa.Numeric(18, 2),
                                             nullable=False, server_default="0"))
    op.add_column("sales_invoice", sa.Column("expenses_operating", sa.Numeric(18, 2),
                                             nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("sales_invoice", "expenses_operating")
    op.drop_column("sales_invoice", "expenses_billed")
    op.drop_index("ix_sales_invoice_expense_invoice", table_name="sales_invoice_expense")
    op.drop_table("sales_invoice_expense")
