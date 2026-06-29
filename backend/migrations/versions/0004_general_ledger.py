"""General Ledger & Chart of Accounts — additive to 001/002/003 (T029).

Extends the `account` table into a chart of accounts (parent_id, code, name, nature, is_postable,
is_system), extends the `account_type` enum (+opening_balance_equity, +user_defined), adds
`ledger_line.statement` (بيان) and `ledger_entry.entry_date` (accounting date), adds the
`accountant` role, then seeds the standard chart and re-homes existing system accounts under groups.

No 001/002/003 table is dropped or redefined; no money data is backfilled (Principle I).
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.orm import Session

import src.models  # noqa: F401  (populate metadata)

revision = "0004_general_ledger"
down_revision = "0003_after_sales_loyalty"
branch_labels = None
depends_on = None

_ACCOUNT_ENUM_NEW = (
    "ENUM('treasury','custody','customer_receivable',"
    "'supplier_payable','sales_revenue','purchases_expense','loyalty_expense',"
    "'opening_balance_equity','user_defined')"
)
_ACCOUNT_ENUM_OLD = (
    "ENUM('treasury','custody','customer_receivable',"
    "'supplier_payable','sales_revenue','purchases_expense','loyalty_expense')"
)
_NATURE_ENUM = "ENUM('asset','liability','equity','income','expense')"
_ROLE_ENUM_NEW = (
    "ENUM('system_admin','branch_manager','purchasing_manager','sales_manager',"
    "'after_sales_staff','sales_rep','accountant')"
)
_ROLE_ENUM_OLD = (
    "ENUM('system_admin','branch_manager','purchasing_manager','sales_manager',"
    "'after_sales_staff','sales_rep')"
)


def upgrade() -> None:
    bind = op.get_bind()
    is_mysql = bind.dialect.name in ("mysql", "mariadb")

    # 1. Extend the account_type and role enums (MySQL only; SQLite uses VARCHAR).
    if is_mysql:
        op.execute(f"ALTER TABLE account MODIFY account_type {_ACCOUNT_ENUM_NEW} NOT NULL")
        op.execute(f"ALTER TABLE role MODIFY name {_ROLE_ENUM_NEW} NOT NULL")

    # 2. Add chart columns to `account`.
    op.add_column("account", sa.Column("parent_id", sa.BigInteger(), nullable=True))
    op.add_column("account", sa.Column("code", sa.String(length=40), nullable=True))
    op.add_column("account", sa.Column("name", sa.String(length=160), nullable=True))
    if is_mysql:
        op.execute(f"ALTER TABLE account ADD COLUMN nature {_NATURE_ENUM} NULL")
    else:
        op.add_column("account", sa.Column("nature", sa.String(length=20), nullable=True))
    op.add_column(
        "account", sa.Column("is_postable", sa.Boolean(), nullable=False, server_default=sa.true())
    )
    op.add_column(
        "account", sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.false())
    )
    op.create_index("ix_account_parent_id", "account", ["parent_id"])
    op.create_unique_constraint("uq_account_code", "account", ["code"])
    op.create_foreign_key("fk_account_parent", "account", "account", ["parent_id"], ["id"])

    # 3. Per-line بيان on ledger_line; accounting date on ledger_entry.
    op.add_column("ledger_line", sa.Column("statement", sa.String(length=255), nullable=True))
    op.add_column("ledger_entry", sa.Column("entry_date", sa.Date(), nullable=True))

    # 4. Seed the accountant role + the standard chart (re-homes existing system accounts).
    from src.models.role import Role, RoleName
    from src.services import chart_service

    session = Session(bind=bind)
    if session.query(Role).filter(Role.name == RoleName.accountant).one_or_none() is None:
        session.add(Role(name=RoleName.accountant))
        session.flush()
    chart_service.seed_standard_chart(session)
    session.commit()


def downgrade() -> None:
    bind = op.get_bind()
    is_mysql = bind.dialect.name in ("mysql", "mariadb")

    op.drop_column("ledger_entry", "entry_date")
    op.drop_column("ledger_line", "statement")
    op.drop_constraint("fk_account_parent", "account", type_="foreignkey")
    op.drop_constraint("uq_account_code", "account", type_="unique")
    op.drop_index("ix_account_parent_id", table_name="account")
    for col in ("is_system", "is_postable", "nature", "name", "code", "parent_id"):
        op.drop_column("account", col)

    if is_mysql:
        # Remove the user_defined/opening_balance_equity chart rows first (they break the old enum).
        op.execute(
            "DELETE FROM account WHERE account_type IN ('user_defined','opening_balance_equity')"
        )
        op.execute(f"ALTER TABLE account MODIFY account_type {_ACCOUNT_ENUM_OLD} NOT NULL")
        op.execute("DELETE FROM role WHERE name = 'accountant'")
        op.execute(f"ALTER TABLE role MODIFY name {_ROLE_ENUM_OLD} NOT NULL")
