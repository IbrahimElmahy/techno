"""كوبونات الفاتورة لكل نوع — a book per kind instead of one range for all of them.

The invoice carried `coupon_serial_from/to` and a single `coupon_count`. That records THAT coupons
were handed over and never WHICH: a counter giving out a hundred gold and fifty silver had one
range to put them in and had to choose which of the two to write down.

This adds a row per kind, each with its own count and its own serial range. The range is kept
because it is what the returns app checks a returned serial against; the kind is what lets the
books say «مئة ذهبي وخمسين فضي» instead of leaving it to whoever was on the counter to remember.

`coupon_type_id` is nullable on purpose: a book with no type printed on it is still a book, and
refusing to record it would push the count back out of the system.

The three old columns stay. Every invoice already written uses them, and dropping them to tidy up
would erase the only record those sales have of what was handed over.

Revision ID: 0049_invoice_coupons_per_kind
Revises: 0048_branch_notes
"""
from alembic import op
import sqlalchemy as sa

revision = "0049_invoice_coupons_per_kind"
down_revision = "0048_branch_notes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sales_invoice_coupon",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("invoice_id", sa.BigInteger(), nullable=False),
        sa.Column("coupon_type_id", sa.BigInteger(), nullable=True),
        sa.Column("count", sa.Integer(), nullable=True),
        sa.Column("serial_from", sa.String(length=24), nullable=True),
        sa.Column("serial_to", sa.String(length=24), nullable=True),
        sa.ForeignKeyConstraint(["invoice_id"], ["sales_invoice.id"]),
        sa.ForeignKeyConstraint(["coupon_type_id"], ["coupon_type.id"]),
    )
    op.create_index("ix_sales_invoice_coupon_invoice_id", "sales_invoice_coupon", ["invoice_id"])
    op.create_index("ix_sales_invoice_coupon_serial_from", "sales_invoice_coupon", ["serial_from"])


def downgrade() -> None:
    op.drop_index("ix_sales_invoice_coupon_serial_from", table_name="sales_invoice_coupon")
    op.drop_index("ix_sales_invoice_coupon_invoice_id", table_name="sales_invoice_coupon")
    op.drop_table("sales_invoice_coupon")
