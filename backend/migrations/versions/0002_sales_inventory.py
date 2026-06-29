"""Sales & Inventory — additive to Foundation (T045).

Extends the `account` enum (+supplier_payable, +sales_revenue, +purchases_expense), creates all new
tables, and installs `stock_movement` immutability triggers (MySQL). No Foundation table is dropped
or redefined; no data backfill (Principle I).
"""
from __future__ import annotations

from alembic import op

from src.core.db import Base
import src.models  # noqa: F401  (populate metadata)

revision = "0002_sales_inventory"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None

_NEW_TABLES = [
    "item", "supplier", "supplier_account", "stock_movement", "stock_locator",
    "purchase_invoice", "purchase_invoice_line", "purchase_return", "purchase_return_line",
    "sales_invoice", "sales_invoice_line", "sales_return", "sales_return_line", "sales_setting",
    "manufacturing_op", "stock_transfer",
]

_ACCOUNT_ENUM = (
    "ENUM('treasury','custody','customer_receivable',"
    "'supplier_payable','sales_revenue','purchases_expense')"
)


def _tables():
    return [Base.metadata.tables[name] for name in _NEW_TABLES]


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name in ("mysql", "mariadb"):
        op.execute(f"ALTER TABLE account MODIFY account_type {_ACCOUNT_ENUM} NOT NULL")

    Base.metadata.create_all(bind=bind, tables=_tables())

    if bind.dialect.name in ("mysql", "mariadb"):
        op.execute(
            """
            CREATE TRIGGER trg_stock_movement_no_update BEFORE UPDATE ON stock_movement
            FOR EACH ROW SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'stock_movement is immutable; post a reversal movement instead';
            """
        )
        op.execute(
            """
            CREATE TRIGGER trg_stock_movement_no_delete BEFORE DELETE ON stock_movement
            FOR EACH ROW SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'stock_movement is immutable; post a reversal movement instead';
            """
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name in ("mysql", "mariadb"):
        op.execute("DROP TRIGGER IF EXISTS trg_stock_movement_no_update")
        op.execute("DROP TRIGGER IF EXISTS trg_stock_movement_no_delete")
    Base.metadata.drop_all(bind=bind, tables=list(reversed(_tables())))
    if bind.dialect.name in ("mysql", "mariadb"):
        op.execute(
            "ALTER TABLE account MODIFY account_type "
            "ENUM('treasury','custody','customer_receivable') NOT NULL"
        )
