import sqlalchemy as sa
from alembic import op

revision = "0074_care_commission"
down_revision = "0073_commission_pools"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    cols = {c["name"] for c in insp.get_columns("employee_commission_rule")}
    if "inspection_rate" not in cols:
        op.add_column("employee_commission_rule",
                      sa.Column("inspection_rate", sa.Numeric(18, 2), nullable=True))
    if "plumber_rate" not in cols:
        op.add_column("employee_commission_rule",
                      sa.Column("plumber_rate", sa.Numeric(18, 2), nullable=True))
    if "all_techs" not in cols:
        op.add_column("employee_commission_rule",
                      sa.Column("all_techs", sa.Boolean(), nullable=False,
                                server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("employee_commission_rule", "all_techs")
    op.drop_column("employee_commission_rule", "plumber_rate")
    op.drop_column("employee_commission_rule", "inspection_rate")
