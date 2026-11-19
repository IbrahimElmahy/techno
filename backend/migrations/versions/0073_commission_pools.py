"""عمولة من تحصيل جهات (سيارات/مناطق) بنسبة للبولي ونسبة للأبيض وتقسيم على عدد.

Revision ID: 0073_commission_pools
Revises: 0072_advance_cash_repayments
"""
import sqlalchemy as sa
from alembic import op

revision = "0073_commission_pools"
down_revision = "0072_advance_cash_repayments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    cols = {c["name"] for c in insp.get_columns("employee_commission_rule")}
    if "white_pct" not in cols:
        op.add_column("employee_commission_rule", sa.Column("white_pct", sa.Numeric(5, 2), nullable=True))
    if "pools" not in cols:
        op.add_column("employee_commission_rule", sa.Column("pools", sa.String(200), nullable=True))
    if "split" not in cols:
        op.add_column("employee_commission_rule", sa.Column("split", sa.Integer(), nullable=False,
                                                            server_default="1"))
    tables = set(insp.get_table_names())
    if "commission_pool" not in tables:
        op.create_table(
            "commission_pool",
            sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column("branch_id", sa.BigInteger(), sa.ForeignKey("branch.id"), nullable=False, index=True),
            sa.Column("name", sa.String(80), nullable=False),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )
    if "commission_pool_amount" not in tables:
        op.create_table(
            "commission_pool_amount",
            sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column("pool_id", sa.BigInteger(), sa.ForeignKey("commission_pool.id"), nullable=False, index=True),
            sa.Column("year", sa.Integer(), nullable=False),
            sa.Column("month", sa.Integer(), nullable=False),
            sa.Column("poly", sa.Numeric(18, 2), nullable=False, server_default="0"),
            sa.Column("white", sa.Numeric(18, 2), nullable=False, server_default="0"),
            sa.Column("actor_user_id", sa.BigInteger(), sa.ForeignKey("user.id"), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("pool_id", "year", "month", name="uq_commission_pool_month"),
        )


def downgrade() -> None:
    op.drop_table("commission_pool_amount")
    op.drop_table("commission_pool")
    op.drop_column("employee_commission_rule", "split")
    op.drop_column("employee_commission_rule", "pools")
    op.drop_column("employee_commission_rule", "white_pct")
