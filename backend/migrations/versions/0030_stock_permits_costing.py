"""إذن إضافة/صرف + نوع التكلفة — B5.

Two new tables for the permit document and its lines, and a singleton settings row for the
costing method. Purely additive: with no permits and the default method, every existing balance
and every cost already frozen onto a document is byte-identical to before.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0030_stock_permits_costing"
down_revision = "0029_stock_limits_batches"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stock_permit",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("document_number", sa.String(24), nullable=False, unique=True),
        sa.Column("kind", sa.Enum("receipt", "issue", name="permitkind"), nullable=False),
        sa.Column("warehouse_id", sa.BigInteger(), sa.ForeignKey("warehouse.id"), nullable=False),
        sa.Column("permit_date", sa.Date(), nullable=True),
        sa.Column("reason", sa.String(240), nullable=True),
        sa.Column("notes", sa.String(500), nullable=True),
        sa.Column("total_cost", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("reverses_id", sa.BigInteger(), sa.ForeignKey("stock_permit.id"),
                  nullable=True, unique=True),
        sa.Column("actor_user_id", sa.BigInteger(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_stock_permit_kind", "stock_permit", ["kind"])
    op.create_index("ix_stock_permit_warehouse_id", "stock_permit", ["warehouse_id"])

    op.create_table(
        "stock_permit_line",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("permit_id", sa.BigInteger(), sa.ForeignKey("stock_permit.id"), nullable=False),
        sa.Column("item_id", sa.BigInteger(), sa.ForeignKey("item.id"), nullable=False),
        sa.Column("quantity", sa.Numeric(18, 3), nullable=False),
        sa.Column("unit_cost", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("line_cost", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("stock_movement_id", sa.BigInteger(), sa.ForeignKey("stock_movement.id"),
                  nullable=True),
    )
    op.create_index("ix_stock_permit_line_permit_id", "stock_permit_line", ["permit_id"])
    op.create_index("ix_stock_permit_line_item_id", "stock_permit_line", ["item_id"])

    op.create_table(
        "stock_setting",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("costing_method",
                  sa.Enum("average", "last_purchase", name="costingmethod"),
                  nullable=False, server_default="average"),
        sa.Column("updated_by", sa.BigInteger(), sa.ForeignKey("user.id"), nullable=True),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("stock_setting")
    op.drop_index("ix_stock_permit_line_item_id", table_name="stock_permit_line")
    op.drop_index("ix_stock_permit_line_permit_id", table_name="stock_permit_line")
    op.drop_table("stock_permit_line")
    op.drop_index("ix_stock_permit_warehouse_id", table_name="stock_permit")
    op.drop_index("ix_stock_permit_kind", table_name="stock_permit")
    op.drop_table("stock_permit")
