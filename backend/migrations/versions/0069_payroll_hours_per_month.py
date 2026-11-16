"""ساعات العمل في الشهر: الساعة الإضافي = إجمالي المرتب ÷ ساعات الشهر.

Revision ID: 0069_payroll_hours_per_month
Revises: 0068_payroll_sheet_columns
"""
import sqlalchemy as sa
from alembic import op

revision = "0069_payroll_hours_per_month"
down_revision = "0068_payroll_sheet_columns"
branch_labels = None
depends_on = None


def upgrade() -> None:
    have = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("payroll_setting")}
    if "hours_per_month" not in have:
        op.add_column("payroll_setting", sa.Column("hours_per_month", sa.Integer(),
                                                   nullable=False, server_default="192"))


def downgrade() -> None:
    op.drop_column("payroll_setting", "hours_per_month")
