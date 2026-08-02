"""Barcodes come out of the system, at the client's request.

Feature 010 gave every item a barcode and every alternate unit one of its own. The client does not
want them: «i don't want barcode in my system», said while barcode columns were about to be added
during the a5 parity work.

**This is a deliberate divergence from a5**, not a gap. Their `باركود` column is on السرايل ·
حركات سرايل · حركات انتهاء الصلاحية · جرد عام, and mirroring those screens faithfully would put
barcodes straight back. It is recorded here so the next person reading «a5 has a barcode column and
we do not» finds the reason instead of treating it as an oversight.

The table is dropped rather than left orphaned. A table nobody writes to and nobody reads is a
table somebody will eventually wire back up on the assumption it was meant to be there.

**What replaced it**: nothing had to. An item is identified by `item.code`, which was always unique
and indexed; شاشة معلومات المنتج takes that code, and a scanner that emits it as text still works —
to the screen it is a keyboard.

Revision ID: 0054_drop_barcodes
Revises: 0053_stock_counts
"""
from alembic import op
import sqlalchemy as sa

revision = "0054_drop_barcodes"
down_revision = "0053_stock_counts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("item_barcode")


def downgrade() -> None:
    # Recreates the shape 0009 built, so a rollback lands on a schema the old code can run against.
    # The barcodes themselves are gone — a downgrade restores the table, never its rows.
    op.create_table(
        "item_barcode",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("item_id", sa.BigInteger(), nullable=False),
        sa.Column("barcode", sa.String(length=64), nullable=False),
        sa.Column("unit", sa.String(length=16), nullable=True),
        sa.ForeignKeyConstraint(["item_id"], ["item.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("barcode", name="uq_item_barcode_barcode"),
    )
    op.create_index("ix_item_barcode_item_id", "item_barcode", ["item_id"])
