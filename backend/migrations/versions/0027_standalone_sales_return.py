"""Standalone sales returns — 028.

A return "like a sales invoice but reversed": pick a customer + items directly (no originating
invoice), goods go back INTO stock, the customer is credited. The invoice link becomes optional and
the return carries its own customer / location / cash account and priced lines. Existing invoice-bound
returns are untouched (new columns default to 0 / NULL).
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0027_standalone_sales_return"
down_revision = "0026_sale_line_discount"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("sales_return", "sales_invoice_id", existing_type=sa.BigInteger(),
                    nullable=True)
    op.add_column("sales_return", sa.Column("customer_id", sa.BigInteger(), nullable=True))
    op.add_column("sales_return", sa.Column("origin_location_kind", sa.String(20), nullable=True))
    op.add_column("sales_return", sa.Column("origin_location_id", sa.BigInteger(), nullable=True))
    op.add_column("sales_return", sa.Column("gross", sa.Numeric(18, 2), nullable=False,
                                            server_default="0"))
    op.add_column("sales_return", sa.Column("combined_pct", sa.Numeric(5, 2), nullable=False,
                                            server_default="0"))
    op.add_column("sales_return", sa.Column("tax_amount", sa.Numeric(18, 2), nullable=False,
                                            server_default="0"))
    op.add_column("sales_return", sa.Column("cash_account_id", sa.BigInteger(), nullable=True))

    op.add_column("sales_return_line", sa.Column("unit_price", sa.Numeric(18, 2), nullable=True))
    op.add_column("sales_return_line", sa.Column("discount_pct", sa.Numeric(5, 2), nullable=False,
                                                 server_default="0"))
    op.add_column("sales_return_line", sa.Column("line_total", sa.Numeric(18, 2), nullable=True))
    op.add_column("sales_return_line", sa.Column("unit", sa.String(16), nullable=True))
    op.add_column("sales_return_line", sa.Column("unit_factor", sa.Numeric(18, 3), nullable=False,
                                                 server_default="1"))


def downgrade() -> None:
    op.drop_column("sales_return_line", "unit_factor")
    op.drop_column("sales_return_line", "unit")
    op.drop_column("sales_return_line", "line_total")
    op.drop_column("sales_return_line", "discount_pct")
    op.drop_column("sales_return_line", "unit_price")
    op.drop_column("sales_return", "cash_account_id")
    op.drop_column("sales_return", "tax_amount")
    op.drop_column("sales_return", "combined_pct")
    op.drop_column("sales_return", "gross")
    op.drop_column("sales_return", "origin_location_id")
    op.drop_column("sales_return", "origin_location_kind")
    op.drop_column("sales_return", "customer_id")
    op.alter_column("sales_return", "sales_invoice_id", existing_type=sa.BigInteger(),
                    nullable=False)
