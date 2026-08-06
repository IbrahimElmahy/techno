"""إذن التحويل بقى مستند بسطور، وبيتقال ليه اترفض.

A transfer WAS one item: `item_id` and `quantity` sat on the document, so moving five items meant
five documents created together with nothing tying them. «امسح صنف من الإذن» then had exactly one
possible meaning — delete the document — which is the thing that must not happen to a request
somebody may have to answer for.

The item moves onto lines and the document becomes what it always was in people's heads: one
request, from here to there, carrying several things.

The document's own `item_id`/`quantity` are LEFT IN PLACE. Every transfer written before this has
them, approval falls back to them when a document has no lines, and rewriting history to fit a new
shape would be far worse than the gap it closes.

`reject_reason` comes with it: `TransferStatus.rejected` has existed since the transfer was first
written and nothing ever set it, so a request that was not going to happen had two ways out —
approve it anyway, or leave it pending for good.

Revision ID: 0062_transfer_lines
Revises: 0061_customer_return_warehouse
"""
from alembic import op
import sqlalchemy as sa

revision = "0062_transfer_lines"
down_revision = "0061_customer_return_warehouse"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("stock_transfer", sa.Column("reject_reason", sa.String(240), nullable=True))
    op.create_table(
        "stock_transfer_line",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("transfer_id", sa.BigInteger(),
                  sa.ForeignKey("stock_transfer.id"), nullable=False, index=True),
        sa.Column("item_id", sa.BigInteger(), sa.ForeignKey("item.id"), nullable=False),
        sa.Column("quantity", sa.Numeric(18, 3), nullable=False),
        sa.Column("out_movement_id", sa.BigInteger(), nullable=True),
        sa.Column("in_movement_id", sa.BigInteger(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("stock_transfer_line")
    op.drop_column("stock_transfer", "reject_reason")
