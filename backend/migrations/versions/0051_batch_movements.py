"""حركات انتهاء الصلاحية — where each lot went, not only what is left of it.

`stock_batch` holds the REMAINING quantity of a lot. That answers «how much of the March batch is
left» and never «where did the rest of it go» — the question asked the day a lot is recalled and
every unit has to be traced to the invoice that sold it. Their `/expiretransactions` is a screen of
its own for exactly that.

It could not be derived afterwards. A stock movement carries a quantity and a date, not which
expiry lot the quantity came out of; FEFO makes that choice at the moment of sale, and unwritten it
is gone.

The lot is identified by its expiry date rather than by a `stock_batch` row id, because lots merge
and split as goods move between locations while the date stays true about the goods themselves.

A relocation writes two rows — out of the source, into the destination. One row holding both ends
would make every reader work out which end it was looking at.

Nothing backfills, for the same reason as the serial trail: a guess in a table people read as fact
is worse than an empty table that says it is empty.

Revision ID: 0051_batch_movements
Revises: 0050_serial_movements
"""
from alembic import op
import sqlalchemy as sa

revision = "0051_batch_movements"
down_revision = "0050_serial_movements"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stock_batch_movement",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("item_id", sa.BigInteger(), nullable=False),
        sa.Column("expiry_date", sa.Date(), nullable=False),
        sa.Column(
            "location_kind",
            sa.Enum("warehouse", "custody", name="locationkind"),
            nullable=False,
        ),
        sa.Column("location_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "kind",
            sa.Enum("received", "consumed", "relocated_out", "relocated_in", "returned",
                    name="batchmovementkind"),
            nullable=False,
        ),
        sa.Column("quantity", sa.Numeric(18, 3), nullable=False),
        sa.Column("document_type", sa.String(length=40), nullable=True),
        sa.Column("document_id", sa.BigInteger(), nullable=True),
        sa.Column("actor_user_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["item_id"], ["item.id"]),
        sa.ForeignKeyConstraint(["actor_user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    # The recall question — «one item's lot, everywhere it went» — is the reason this table exists,
    # so it gets the compound index rather than two separate ones it would have to intersect.
    op.create_index(
        "ix_batch_movement_lot", "stock_batch_movement", ["item_id", "expiry_date"]
    )
    op.create_index("ix_batch_movement_created_at", "stock_batch_movement", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_batch_movement_created_at", table_name="stock_batch_movement")
    op.drop_index("ix_batch_movement_lot", table_name="stock_batch_movement")
    op.drop_table("stock_batch_movement")
