"""الموظفون والوظائف + طلبات البيع والشراء + «يظهر في» — B8/B9.

Three new tables and one nullable column. Additive throughout: with no employees and no orders,
and `appears_in` NULL everywhere (which means "follow the account's nature"), the system behaves
exactly as it did before.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0032_employees_orders"
down_revision = "0031_fixed_assets"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "job_title",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(120), nullable=False, unique=True),
        sa.Column("description", sa.String(240), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "employee",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("code", sa.String(24), nullable=False, unique=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("job_title_id", sa.BigInteger(), sa.ForeignKey("job_title.id"), nullable=True),
        sa.Column("department", sa.String(120), nullable=True),
        sa.Column("phone", sa.String(32), nullable=True),
        sa.Column("national_id", sa.String(32), nullable=True),
        sa.Column("hire_date", sa.Date(), nullable=True),
        sa.Column("salary", sa.Numeric(18, 2), nullable=True),
        sa.Column("branch_id", sa.BigInteger(), sa.ForeignKey("branch.id"), nullable=True),
        # An employee is not a user; this is set only for the ones who also log in.
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("user.id"), nullable=True,
                  unique=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("notes", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_employee_name", "employee", ["name"])
    op.create_index("ix_employee_branch_id", "employee", ["branch_id"])

    op.create_table(
        "trade_order",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("document_number", sa.String(24), nullable=False, unique=True),
        sa.Column("kind", sa.Enum("sale", "purchase", name="orderkind"), nullable=False),
        sa.Column("status", sa.Enum("open", "converted", "cancelled", name="orderstatus"),
                  nullable=False, server_default="open"),
        sa.Column("customer_id", sa.BigInteger(), sa.ForeignKey("customer.id"), nullable=True),
        sa.Column("supplier_id", sa.BigInteger(), sa.ForeignKey("supplier.id"), nullable=True),
        sa.Column("order_date", sa.Date(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("warehouse_id", sa.BigInteger(), sa.ForeignKey("warehouse.id"), nullable=True),
        sa.Column("branch_id", sa.BigInteger(), sa.ForeignKey("branch.id"), nullable=True),
        sa.Column("total", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("notes", sa.String(500), nullable=True),
        # The invoice this order became — set once, which is what stops a double sale.
        sa.Column("converted_invoice_id", sa.BigInteger(), nullable=True),
        sa.Column("converted_at", sa.DateTime(), nullable=True),
        sa.Column("actor_user_id", sa.BigInteger(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_trade_order_kind", "trade_order", ["kind"])
    op.create_index("ix_trade_order_status", "trade_order", ["status"])

    op.create_table(
        "trade_order_line",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("order_id", sa.BigInteger(), sa.ForeignKey("trade_order.id"), nullable=False),
        sa.Column("item_id", sa.BigInteger(), sa.ForeignKey("item.id"), nullable=False),
        sa.Column("quantity", sa.Numeric(18, 3), nullable=False),
        sa.Column("unit_price", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("line_total", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("notes", sa.String(240), nullable=True),
    )
    op.create_index("ix_trade_order_line_order_id", "trade_order_line", ["order_id"])

    # «يظهر في» — NULL means "follow the account's nature", which is what every account does now.
    op.add_column("account", sa.Column("appears_in", sa.String(24), nullable=True))


def downgrade() -> None:
    op.drop_column("account", "appears_in")
    op.drop_index("ix_trade_order_line_order_id", table_name="trade_order_line")
    op.drop_table("trade_order_line")
    op.drop_index("ix_trade_order_status", table_name="trade_order")
    op.drop_index("ix_trade_order_kind", table_name="trade_order")
    op.drop_table("trade_order")
    op.drop_index("ix_employee_branch_id", table_name="employee")
    op.drop_index("ix_employee_name", table_name="employee")
    op.drop_table("employee")
    op.drop_table("job_title")
