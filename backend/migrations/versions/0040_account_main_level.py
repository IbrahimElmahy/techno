"""المستوى الرئيسي على الحساب + «يظهر في» بقيمه الثلاث.

The column is additive. The `appears_in` change is a change of *meaning*, not of type: it used to
accept "income_statement" and now accepts "trading" or "profit_loss" instead, because Egyptian
practice prints those as two statements and merging them loses the gross-profit line.

Any row already carrying the old value is migrated to "profit_loss" — the safer of the two, since
an account wrongly on المتاجرة would overstate cost of sales and move gross profit, while one
wrongly on أرباح وخسائر only lands lower down the same statement.

Revision ID: 0040_account_main_level
Revises: 0039_master_data_parity
"""
from alembic import op
import sqlalchemy as sa

revision = "0040_account_main_level"
down_revision = "0039_master_data_parity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("account", sa.Column("main_level", sa.String(length=80), nullable=True))
    op.execute(
        "UPDATE account SET appears_in = 'profit_loss' WHERE appears_in = 'income_statement'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE account SET appears_in = 'income_statement' "
        "WHERE appears_in IN ('trading', 'profit_loss')"
    )
    op.drop_column("account", "main_level")
