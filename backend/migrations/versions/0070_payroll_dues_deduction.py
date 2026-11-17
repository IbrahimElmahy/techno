"""خصم من مستحقات الموظف في سطر المرتب.

Revision ID: 0070_payroll_dues_deduction
Revises: 0069_payroll_hours_per_month
"""
import sqlalchemy as sa
from alembic import op

revision = "0070_payroll_dues_deduction"
down_revision = "0069_payroll_hours_per_month"
branch_labels = None
depends_on = None


def upgrade() -> None:
    have = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("payroll_line")}
    if "dues_deduction" not in have:
        op.add_column("payroll_line", sa.Column("dues_deduction", sa.Numeric(18, 2), nullable=True))


def downgrade() -> None:
    op.drop_column("payroll_line", "dues_deduction")
