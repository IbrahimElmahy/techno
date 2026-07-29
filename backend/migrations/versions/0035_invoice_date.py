"""تاريخ فاتورة البيع — the day the sale happened.

Nullable and additive: an invoice without one behaves exactly as it always did, dated by
`created_at`. When present it dates the ledger entry too, which is the point — a document dated
one day and posted on another makes every statement disagree with the paper.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0035_invoice_date"
down_revision = "0034_coupon_receipts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sales_invoice", sa.Column("invoice_date", sa.Date(), nullable=True))
    op.create_index("ix_sales_invoice_invoice_date", "sales_invoice", ["invoice_date"])


def downgrade() -> None:
    op.drop_index("ix_sales_invoice_invoice_date", table_name="sales_invoice")
    op.drop_column("sales_invoice", "invoice_date")
