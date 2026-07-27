"""استلام الكوبونات من العملاء.

The unique constraint on the serial is the feature, not a detail: a coupon is a bearer document,
so it can be handed in exactly once, and two branches receiving the same one at the same moment
must not both succeed. That belongs in the database, not only in the service that checks it.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0034_coupon_receipts"
down_revision = "0033_invoice_coupon_range"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "coupon_receipt",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("document_number", sa.String(24), nullable=False, unique=True),
        sa.Column("customer_id", sa.BigInteger(), sa.ForeignKey("customer.id"), nullable=True),
        sa.Column("rep_user_id", sa.BigInteger(), sa.ForeignKey("user.id"), nullable=True),
        sa.Column("received_date", sa.Date(), nullable=True),
        sa.Column("coupon_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("notes", sa.String(500), nullable=True),
        # Idempotency key from the mobile app — a queued receipt retried must land once.
        sa.Column("client_uuid", sa.String(64), nullable=True, unique=True),
        sa.Column("actor_user_id", sa.BigInteger(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_coupon_receipt_customer", "coupon_receipt", ["customer_id"])
    op.create_index("ix_coupon_receipt_rep", "coupon_receipt", ["rep_user_id"])

    op.create_table(
        "coupon_receipt_line",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("receipt_id", sa.BigInteger(), sa.ForeignKey("coupon_receipt.id"),
                  nullable=False),
        sa.Column("serial", sa.String(24), nullable=False),
        sa.Column("sales_invoice_id", sa.BigInteger(), sa.ForeignKey("sales_invoice.id"),
                  nullable=False),
        sa.UniqueConstraint("serial", name="uq_coupon_receipt_serial"),
    )
    op.create_index("ix_coupon_receipt_line_receipt", "coupon_receipt_line", ["receipt_id"])
    op.create_index("ix_coupon_receipt_line_serial", "coupon_receipt_line", ["serial"])


def downgrade() -> None:
    op.drop_index("ix_coupon_receipt_line_serial", table_name="coupon_receipt_line")
    op.drop_index("ix_coupon_receipt_line_receipt", table_name="coupon_receipt_line")
    op.drop_table("coupon_receipt_line")
    op.drop_index("ix_coupon_receipt_rep", table_name="coupon_receipt")
    op.drop_index("ix_coupon_receipt_customer", table_name="coupon_receipt")
    op.drop_table("coupon_receipt")
