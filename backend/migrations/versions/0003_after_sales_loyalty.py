"""After-Sales Loyalty — additive to 001/002 (T039).

Extends the `account` enum (+`loyalty_expense`), creates all new loyalty tables, and installs
`point_record` immutability triggers (MySQL). No 001/002 table dropped or redefined; no data backfill.
"""
from __future__ import annotations

from alembic import op

from src.core.db import Base
import src.models  # noqa: F401  (populate metadata)

revision = "0003_after_sales_loyalty"
down_revision = "0002_sales_inventory"
branch_labels = None
depends_on = None

_NEW_TABLES = [
    "product_point_value", "point_conversion", "coupon_type", "coupon",
    "point_record", "coupon_redemption",
]

_ACCOUNT_ENUM = (
    "ENUM('treasury','custody','customer_receivable',"
    "'supplier_payable','sales_revenue','purchases_expense','loyalty_expense')"
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
            CREATE TRIGGER trg_point_record_no_update BEFORE UPDATE ON point_record
            FOR EACH ROW SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'point_record is immutable; post a new linked record instead';
            """
        )
        op.execute(
            """
            CREATE TRIGGER trg_point_record_no_delete BEFORE DELETE ON point_record
            FOR EACH ROW SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'point_record is immutable; post a new linked record instead';
            """
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name in ("mysql", "mariadb"):
        op.execute("DROP TRIGGER IF EXISTS trg_point_record_no_update")
        op.execute("DROP TRIGGER IF EXISTS trg_point_record_no_delete")
    Base.metadata.drop_all(bind=bind, tables=list(reversed(_tables())))
    if bind.dialect.name in ("mysql", "mariadb"):
        op.execute(
            "ALTER TABLE account MODIFY account_type "
            "ENUM('treasury','custody','customer_receivable',"
            "'supplier_payable','sales_revenue','purchases_expense') NOT NULL"
        )
