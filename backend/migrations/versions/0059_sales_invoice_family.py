"""الفاتورة بتقول هي على أنهي حساب — أبيض ولا بولي.

The customer holds one receivable account per product line (0058). The invoice has to say which one
it belongs to, and it has to say so ON THE DOCUMENT rather than being worked out again later: a
return must go back to the same account the sale posted to, and resolving it a second time would
send a refund to whichever line the customer happens to be split into by then.

Nullable, because it IS null for every customer who was never split — which is most of them, and
all of them before today.

Revision ID: 0059_sales_invoice_family
Revises: 0058_customer_account_family
"""
from alembic import op
import sqlalchemy as sa

revision = "0059_sales_invoice_family"
down_revision = "0058_customer_account_family"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sales_invoice", sa.Column("family", sa.String(40), nullable=True))


def downgrade() -> None:
    op.drop_column("sales_invoice", "family")
