"""Per-line discount on sales invoice lines — 027.

Each line carries its own discount % (the item's fixed default + a typed variable), applied
before the invoice-level discount. Existing lines get 0, so nothing changes for them.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0026_sale_line_discount"
down_revision = "0025_item_price_history"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sales_invoice_line",
                  sa.Column("discount_pct", sa.Numeric(5, 2), nullable=False,
                            server_default="0"))


def downgrade() -> None:
    op.drop_column("sales_invoice_line", "discount_pct")
