"""حركات سرايل — a trail for each serial instead of only where it is now.

`item_serial` holds a unit's CURRENT status and location. That answers «where is serial X?» and
cannot answer «where has it been, and on which document?» — the question actually asked when a
customer returns a unit claiming they never bought it, or when one turns up in a store nobody sent
it to. Their `/serialtransactions` is a screen of its own for exactly that.

It could not be derived after the fact: stock movements carry quantities, and a quantity does not
name which unit moved. So the four places a serial changes hands each write a row here.

`serial` is copied onto the row rather than joined for. A serial can be removed from a mis-keyed
receipt, and the record of what moved has to survive the row that described it.

Nothing backfills. Units received before this release have no trail, and inventing one — «probably
received at the location it is sitting in» — would put a guess in a table people will read as fact.

Revision ID: 0050_serial_movements
Revises: 0049_invoice_coupons_per_kind
"""
from alembic import op
import sqlalchemy as sa

revision = "0050_serial_movements"
down_revision = "0049_invoice_coupons_per_kind"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "item_serial_movement",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("serial_id", sa.BigInteger(), nullable=False),
        sa.Column("item_id", sa.BigInteger(), nullable=False),
        sa.Column("serial", sa.String(length=64), nullable=False),
        sa.Column(
            "kind",
            sa.Enum("received", "relocated", "sold", "returned", name="serialmovementkind"),
            nullable=False,
        ),
        sa.Column(
            "location_kind",
            sa.Enum("warehouse", "custody", name="locationkind"),
            nullable=True,
        ),
        sa.Column("location_id", sa.BigInteger(), nullable=True),
        sa.Column("document_type", sa.String(length=40), nullable=True),
        sa.Column("document_id", sa.BigInteger(), nullable=True),
        sa.Column("actor_user_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["serial_id"], ["item_serial.id"]),
        sa.ForeignKeyConstraint(["item_id"], ["item.id"]),
        sa.ForeignKeyConstraint(["actor_user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    # The three ways this table gets read: one serial's history, one item's units, and «what moved
    # this week» — each is a screen, so each gets an index rather than a scan.
    op.create_index("ix_serial_movement_serial_id", "item_serial_movement", ["serial_id"])
    op.create_index("ix_serial_movement_item_id", "item_serial_movement", ["item_id"])
    op.create_index("ix_serial_movement_serial", "item_serial_movement", ["serial"])
    op.create_index("ix_serial_movement_created_at", "item_serial_movement", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_serial_movement_created_at", table_name="item_serial_movement")
    op.drop_index("ix_serial_movement_serial", table_name="item_serial_movement")
    op.drop_index("ix_serial_movement_item_id", table_name="item_serial_movement")
    op.drop_index("ix_serial_movement_serial_id", table_name="item_serial_movement")
    op.drop_table("item_serial_movement")
