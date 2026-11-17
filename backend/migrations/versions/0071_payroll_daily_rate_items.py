"""بنود حساب اليوم في المرتبات، وساعات الغياب في سطر المرتب.

Revision ID: 0071_payroll_daily_rate_items
Revises: 0070_payroll_dues_deduction
"""
import sqlalchemy as sa
from alembic import op

revision = "0071_payroll_daily_rate_items"
down_revision = "0070_payroll_dues_deduction"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "in_daily_rate" not in {c["name"] for c in sa.inspect(bind).get_columns("salary_component")}:
        op.add_column("salary_component", sa.Column("in_daily_rate", sa.Boolean(), nullable=False,
                                                    server_default=sa.false()))
        op.execute("update salary_component set in_daily_rate = true where name = 'بدلات'")
    if "absent_hours" not in {c["name"] for c in sa.inspect(bind).get_columns("payroll_line")}:
        op.add_column("payroll_line", sa.Column("absent_hours", sa.Numeric(18, 3), nullable=True))


def downgrade() -> None:
    op.drop_column("payroll_line", "absent_hours")
    op.drop_column("salary_component", "in_daily_rate")
