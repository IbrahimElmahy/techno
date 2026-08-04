"""السند بيقول هو على أنهي مديونية — أبيض ولا بولي ولا الإجمالي.

A customer may owe on more than one product line (0058). A receipt has to say which debt it
settles, or that it is against the whole thing.

NULL means «على إجمالي المديونية» — the collection was split across his lines in proportion — and
it is also what every voucher written before today means, because there was only one debt to
settle then. Those two readings agree, which is why null is safe here.

Revision ID: 0060_voucher_family
Revises: 0059_sales_invoice_family
"""
from alembic import op
import sqlalchemy as sa

revision = "0060_voucher_family"
down_revision = "0059_sales_invoice_family"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("voucher", sa.Column("family", sa.String(40), nullable=True))


def downgrade() -> None:
    op.drop_column("voucher", "family")
