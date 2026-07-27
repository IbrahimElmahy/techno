"""الأصول الثابتة والإهلاك — B6.

Two new tables. The unique (asset, year, month) on the depreciation record is not a nicety: it is
what makes the monthly run safe to click twice, so it belongs in the database and not only in the
service that happens to check it.

No new AccountType: the three accounts a fixed asset posts to are ordinary chart nodes created on
demand by code (1.03.001 / 1.03.002 / 5.003), which avoids altering an enum column in production.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0031_fixed_assets"
down_revision = "0030_stock_permits_costing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "fixed_asset",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("code", sa.String(24), nullable=False, unique=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("category", sa.String(80), nullable=True),
        sa.Column("acquisition_date", sa.Date(), nullable=False),
        sa.Column("cost", sa.Numeric(18, 2), nullable=False),
        sa.Column("salvage_value", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("useful_life_months", sa.Integer(), nullable=False),
        sa.Column("method",
                  sa.Enum("straight_line", "declining_balance", name="depreciationmethod"),
                  nullable=False, server_default="straight_line"),
        sa.Column("status", sa.Enum("active", "disposed", name="assetstatus"),
                  nullable=False, server_default="active"),
        sa.Column("asset_account_id", sa.BigInteger(), sa.ForeignKey("account.id"),
                  nullable=False),
        sa.Column("accumulated_account_id", sa.BigInteger(), sa.ForeignKey("account.id"),
                  nullable=False),
        sa.Column("expense_account_id", sa.BigInteger(), sa.ForeignKey("account.id"),
                  nullable=False),
        sa.Column("branch_id", sa.BigInteger(), sa.ForeignKey("branch.id"), nullable=True),
        sa.Column("cost_center_id", sa.BigInteger(), sa.ForeignKey("cost_center.id"),
                  nullable=True),
        sa.Column("disposal_date", sa.Date(), nullable=True),
        sa.Column("disposal_proceeds", sa.Numeric(18, 2), nullable=True),
        sa.Column("disposal_gain_loss", sa.Numeric(18, 2), nullable=True),
        sa.Column("disposal_entry_id", sa.BigInteger(), sa.ForeignKey("ledger_entry.id"),
                  nullable=True),
        sa.Column("notes", sa.String(500), nullable=True),
        sa.Column("actor_user_id", sa.BigInteger(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_fixed_asset_status", "fixed_asset", ["status"])

    op.create_table(
        "depreciation_record",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("asset_id", sa.BigInteger(), sa.ForeignKey("fixed_asset.id"), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("ledger_entry_id", sa.BigInteger(), sa.ForeignKey("ledger_entry.id"),
                  nullable=True),
        sa.Column("actor_user_id", sa.BigInteger(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("asset_id", "year", "month", name="uq_depreciation_asset_period"),
    )
    op.create_index("ix_depreciation_record_asset_id", "depreciation_record", ["asset_id"])


def downgrade() -> None:
    op.drop_index("ix_depreciation_record_asset_id", table_name="depreciation_record")
    op.drop_table("depreciation_record")
    op.drop_index("ix_fixed_asset_status", table_name="fixed_asset")
    op.drop_table("fixed_asset")
