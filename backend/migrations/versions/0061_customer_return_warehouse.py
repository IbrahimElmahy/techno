"""العميل بيفتكر مخزن مرتجعاته.

Picking the receiving store on every return is asking a question whose answer has not changed since
the last one: a customer's goods come back to the branch that serves him.

Learned rather than configured — the first return written for a customer remembers the store it
went into, and every later one opens on it. NULL means he has never had a return, which is a
different thing from having no preference, and is why this is nullable rather than defaulted.

Revision ID: 0061_customer_return_warehouse
Revises: 0060_voucher_family
"""
from alembic import op
import sqlalchemy as sa

revision = "0061_customer_return_warehouse"
down_revision = "0060_voucher_family"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("customer",
                  sa.Column("default_return_warehouse_id", sa.BigInteger(), nullable=True))


def downgrade() -> None:
    op.drop_column("customer", "default_return_warehouse_id")
