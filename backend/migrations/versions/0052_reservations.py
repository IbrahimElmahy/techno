"""حجز عملاء — stock held for a customer without being sold yet.

A reservation is the one document whose entire effect is on a different screen: it moves nothing,
owes nothing and bills nothing, and all it does is stop somebody else taking the goods. Adding the
table without wiring it into the availability check would give the counter a list of promises with
nothing keeping them — so the sale and the transfer both subtract live holds now.

`expires_on` is required. A promise with no end holds stock forever, and whoever made it has left
by the time anyone notices. Expiry is then computed by comparing the date wherever availability is
read, rather than swept by a nightly job: a status column saying «expired» is wrong for as long as
the job is late, and every screen reading it is wrong with it.

Revision ID: 0052_reservations
Revises: 0051_batch_movements
"""
from alembic import op
import sqlalchemy as sa

revision = "0052_reservations"
down_revision = "0051_batch_movements"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reservation",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("document_number", sa.String(length=24), nullable=False),
        sa.Column("customer_id", sa.BigInteger(), nullable=False),
        sa.Column("item_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "location_kind",
            sa.Enum("warehouse", "custody", name="locationkind"),
            nullable=False,
        ),
        sa.Column("location_id", sa.BigInteger(), nullable=False),
        sa.Column("quantity", sa.Numeric(18, 3), nullable=False),
        sa.Column("expires_on", sa.Date(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("active", "converted", "cancelled", name="reservationstatus"),
            nullable=False,
        ),
        sa.Column("sales_invoice_id", sa.BigInteger(), nullable=True),
        sa.Column("notes", sa.String(length=500), nullable=True),
        sa.Column("actor_user_id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["customer_id"], ["customer.id"]),
        sa.ForeignKeyConstraint(["item_id"], ["item.id"]),
        sa.ForeignKeyConstraint(["sales_invoice_id"], ["sales_invoice.id"]),
        sa.ForeignKeyConstraint(["actor_user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("document_number", name="uq_reservation_document_number"),
    )
    # Read on every sale line and every transfer request, so it is the shape of that query.
    op.create_index(
        "ix_reservation_hold", "reservation",
        ["item_id", "location_kind", "location_id", "status"],
    )


def downgrade() -> None:
    op.drop_index("ix_reservation_hold", table_name="reservation")
    op.drop_table("reservation")
