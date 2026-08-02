"""مردود مبيعات gets its own date — the last field the invoice had and it did not.

The client asked for the return to be an exact replica of the sale. It nearly was: `sales_return`
has carried the whole 030 document set — rep, posting account, external number, notes, three
statements — since that feature shipped. What it never had was **the day the goods came back**.

That matters for the same reason `invoice_date` does: a document dated one day and posted on
another makes every statement disagree with the paper. It is also the first door in the sale's
create flow («التاريخ» before the customer), so without it the return could not follow that flow.

`created_at` is not a substitute. It is when the row was typed, which is often days after the
goods were handed back — and a return entered on Monday for a Saturday return would land in the
wrong week on every report that groups by day.

Nullable, and defaulted to today by the service rather than by the column: existing returns have no
recorded return day, and writing one in now would be inventing a date for goods that came back
before anybody was asked.

Revision ID: 0055_return_date
Revises: 0054_drop_barcodes
"""
from alembic import op
import sqlalchemy as sa

revision = "0055_return_date"
down_revision = "0054_drop_barcodes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sales_return", sa.Column("return_date", sa.Date(), nullable=True))
    op.create_index("ix_sales_return_return_date", "sales_return", ["return_date"])


def downgrade() -> None:
    op.drop_index("ix_sales_return_return_date", table_name="sales_return")
    op.drop_column("sales_return", "return_date")
