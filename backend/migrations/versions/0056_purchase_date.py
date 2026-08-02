"""فاتورة الشراء تاخد تاريخها — the last of the three documents to get one.

The sale has `invoice_date` and the return got `return_date` in 0055. The purchase had the whole
030 document set — rep, expense account, supplier's own number, notes, three statements — and no
day of its own.

`created_at` is not a substitute: it is when the row was typed, and goods received on Thursday and
entered on Sunday would land in the wrong week on every report that groups by day. It also matters
for the opening sequence — التاريخ is the first door the sale asks, and a purchase that could not
store the answer would be asking a question for show.

Nullable, and defaulted to today by the service rather than by the column: purchases already
recorded have no captured receiving day, and writing one in now would invent a date for goods that
arrived before anybody was asked.

Revision ID: 0056_purchase_date
Revises: 0055_return_date
"""
from alembic import op
import sqlalchemy as sa

revision = "0056_purchase_date"
down_revision = "0055_return_date"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("purchase_invoice", sa.Column("purchase_date", sa.Date(), nullable=True))
    op.create_index("ix_purchase_invoice_purchase_date", "purchase_invoice", ["purchase_date"])


def downgrade() -> None:
    op.drop_index("ix_purchase_invoice_purchase_date", table_name="purchase_invoice")
    op.drop_column("purchase_invoice", "purchase_date")
