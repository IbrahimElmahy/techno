"""حقول بطاقة الموظف: العنوان · الحضور · انصراف · عمولة التحصيلات.

Read off their الموظفين form. Three notes on the choices:

* The shift times are text, not a time type. What people actually write is «٨ ص» or «٨:٣٠-٤» as
  often as a clean time, and a column that refuses those is a column that stops being filled in.
* The collection commission is per employee, not per role. Two reps on the same round are routinely
  on different rates, and one rate for the role would quietly pay one of them wrong every month.
* All nullable: an existing employee record is not made invalid by fields nobody has filled yet.

Revision ID: 0045_employee_card_fields
Revises: 0044_edit_lock_days
"""
from alembic import op
import sqlalchemy as sa

revision = "0045_employee_card_fields"
down_revision = "0044_edit_lock_days"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("employee", sa.Column("address", sa.String(length=240), nullable=True))
    op.add_column("employee", sa.Column("work_start", sa.String(length=20), nullable=True))
    op.add_column("employee", sa.Column("work_end", sa.String(length=20), nullable=True))
    op.add_column("employee",
                  sa.Column("collection_commission_pct", sa.Numeric(5, 2), nullable=True))


def downgrade() -> None:
    for col in ("collection_commission_pct", "work_end", "work_start", "address"):
        op.drop_column("employee", col)
