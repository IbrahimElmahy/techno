"""جرد المخازن — the counting cycle, not just the book balance.

`/stocktake` answered «what did the books say the stock was on this day». That is one half of one
stocktake. The other half is what the warehouse actually does: print a sheet, walk the shelves,
write what is there, settle the difference.

Two quantities per line, kept apart on purpose. `book_quantity` is snapshotted when the sheet opens
so the counter is compared against what they were told. The adjustment at posting is computed
against CURRENT stock instead, so a sale that happened legitimately during the count is not applied
a second time — the result is that on-hand ends up equal to what was counted, which is the only
thing a count is for.

`counted_quantity` is nullable rather than defaulting to zero. Zero is a real count — «the shelf is
empty» — and treating an untouched line as zero would write off stock nobody looked at.

`warehouse_id` on the sheet is nullable: NULL is «جرد عام المخازن», their own menu entry, which is
this same document over a wider net rather than a second kind of count.

Revision ID: 0053_stock_counts
Revises: 0052_reservations
"""
from alembic import op
import sqlalchemy as sa

revision = "0053_stock_counts"
down_revision = "0052_reservations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stock_count",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("document_number", sa.String(length=24), nullable=False),
        sa.Column("warehouse_id", sa.BigInteger(), nullable=True),
        sa.Column("count_date", sa.Date(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("draft", "posted", "cancelled", name="stockcountstatus"),
            nullable=False,
        ),
        sa.Column("notes", sa.String(length=500), nullable=True),
        sa.Column("actor_user_id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("posted_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouse.id"]),
        sa.ForeignKeyConstraint(["actor_user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("document_number", name="uq_stock_count_document_number"),
    )
    op.create_table(
        "stock_count_line",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("count_id", sa.BigInteger(), nullable=False),
        sa.Column("item_id", sa.BigInteger(), nullable=False),
        sa.Column("warehouse_id", sa.BigInteger(), nullable=False),
        sa.Column("book_quantity", sa.Numeric(18, 3), nullable=False),
        sa.Column("counted_quantity", sa.Numeric(18, 3), nullable=True),
        sa.Column("stock_movement_id", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(["count_id"], ["stock_count.id"]),
        sa.ForeignKeyConstraint(["item_id"], ["item.id"]),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouse.id"]),
        sa.ForeignKeyConstraint(["stock_movement_id"], ["stock_movement.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_stock_count_line_count", "stock_count_line", ["count_id"])


def downgrade() -> None:
    op.drop_index("ix_stock_count_line_count", table_name="stock_count_line")
    op.drop_table("stock_count_line")
    op.drop_table("stock_count")
