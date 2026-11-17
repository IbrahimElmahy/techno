"""السلفة على حساب الموظف بسند صرف، والتحصيل النقدي بسند قبض، وخطة سداد حرة.

Revision ID: 0072_advance_cash_repayments
Revises: 0071_payroll_daily_rate_items
"""
import sqlalchemy as sa
from alembic import op

revision = "0072_advance_cash_repayments"
down_revision = "0071_payroll_daily_rate_items"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    adv = {c["name"] for c in sa.inspect(bind).get_columns("employee_advance")}
    if "account_id" not in adv:
        op.add_column("employee_advance", sa.Column("account_id", sa.BigInteger(),
                                                    sa.ForeignKey("account.id"), nullable=True))
    if "voucher_id" not in adv:
        op.add_column("employee_advance", sa.Column("voucher_id", sa.BigInteger(),
                                                    sa.ForeignKey("voucher.id"), nullable=True))
    inst = {c["name"] for c in sa.inspect(bind).get_columns("employee_advance_instalment")}
    if "voucher_id" not in inst:
        op.add_column("employee_advance_instalment", sa.Column(
            "voucher_id", sa.BigInteger(), sa.ForeignKey("voucher.id"), nullable=True))
    if "paid_on" not in inst:
        op.add_column("employee_advance_instalment", sa.Column("paid_on", sa.Date(), nullable=True))
    names = {u["name"] for u in sa.inspect(bind).get_unique_constraints("employee_advance_instalment")}
    if "uq_advance_instalment_period" in names:
        op.drop_constraint("uq_advance_instalment_period", "employee_advance_instalment",
                           type_="unique")


def downgrade() -> None:
    op.drop_column("employee_advance_instalment", "paid_on")
    op.drop_column("employee_advance_instalment", "voucher_id")
    op.drop_column("employee_advance", "voucher_id")
    op.drop_column("employee_advance", "account_id")
