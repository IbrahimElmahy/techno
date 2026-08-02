"""مردود الشراء ياخد تاريخه — the fourth and last trade document to get one.

The sale has `invoice_date`, the sales return got `return_date` in 0055, the purchase got
`purchase_date` in 0056. The purchase return had neither a date nor a note.

`created_at` is when the row was typed. Goods sent back to the supplier on Thursday and entered on
Sunday land in the wrong week on every report that groups by day — and «رجعنا للمورد ده كام
ومتى؟» is the question this register exists to answer.

Nullable, and defaulted to today by the service rather than by the column: returns already
recorded have no captured day, and writing one in now would invent a date for goods that went back
before anybody was asked.

Revision ID: 0057_purchase_return_date
Revises: 0056_purchase_date
"""
from alembic import op
import sqlalchemy as sa

revision = "0057_purchase_return_date"
down_revision = "0056_purchase_date"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("purchase_return", sa.Column("return_date", sa.Date(), nullable=True))
    op.add_column("purchase_return", sa.Column("notes", sa.String(500), nullable=True))
    op.create_index("ix_purchase_return_return_date", "purchase_return", ["return_date"])


def downgrade() -> None:
    op.drop_index("ix_purchase_return_return_date", table_name="purchase_return")
    op.drop_column("purchase_return", "notes")
    op.drop_column("purchase_return", "return_date")
