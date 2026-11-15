"""أعمدة شيت المرتبات: أيام إضافي وقيمتها، الانتقالات، قيمة اليوم، ونسبة خصم عجز الساعات.

Revision ID: 0068_payroll_sheet_columns
Revises: 0067_fixed_asset_lifecycle
"""
import sqlalchemy as sa
from alembic import op

revision = "0068_payroll_sheet_columns"
down_revision = "0067_fixed_asset_lifecycle"
branch_labels = None
depends_on = None


def _columns(bind, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    have = _columns(bind, "payroll_line")
    for name, typ in (("extra_days", sa.Numeric(18, 3)), ("extra_days_amount", sa.Numeric(18, 2)),
                      ("transport", sa.Numeric(18, 2)), ("daily_rate", sa.Numeric(18, 2))):
        if name not in have:
            op.add_column("payroll_line", sa.Column(name, typ, nullable=True))
    if "shortage_pct" not in _columns(bind, "payroll_setting"):
        op.add_column("payroll_setting", sa.Column("shortage_pct", sa.Numeric(5, 2),
                                                   nullable=False, server_default="100"))


def downgrade() -> None:
    op.drop_column("payroll_setting", "shortage_pct")
    for name in ("extra_days", "extra_days_amount", "transport", "daily_rate"):
        op.drop_column("payroll_line", name)
