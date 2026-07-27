"""Coupon serial range on the sales invoice — issued with the sale, checked on hand-back.

Coupons come off a printed book, so what the counter actually issues is a range: "from 1200 to
1249". Storing it on the invoice is what later lets a returned serial be traced to a sale that
really happened, which is the check the mobile app needs when the customer brings them back.

Additive and nullable — every existing invoice keeps NULL and behaves exactly as before.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0033_invoice_coupon_range"
down_revision = "0032_employees_orders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sales_invoice", sa.Column("coupon_serial_from", sa.String(24), nullable=True))
    op.add_column("sales_invoice", sa.Column("coupon_serial_to", sa.String(24), nullable=True))
    op.add_column("sales_invoice", sa.Column("coupon_count", sa.Integer(), nullable=True))
    op.create_index("ix_sales_invoice_coupon_from", "sales_invoice", ["coupon_serial_from"])
    op.create_index("ix_sales_invoice_coupon_to", "sales_invoice", ["coupon_serial_to"])


def downgrade() -> None:
    op.drop_index("ix_sales_invoice_coupon_to", table_name="sales_invoice")
    op.drop_index("ix_sales_invoice_coupon_from", table_name="sales_invoice")
    op.drop_column("sales_invoice", "coupon_count")
    op.drop_column("sales_invoice", "coupon_serial_to")
    op.drop_column("sales_invoice", "coupon_serial_from")
