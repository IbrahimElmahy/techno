"""دورة حياة الأصل: الحالة، جزء الشهر الأول، أساس الإهلاك بعد التعديل، وسجل العمليات.

Revision ID: 0067_fixed_asset_lifecycle
Revises: 0066_fixed_asset_categories
"""
import sqlalchemy as sa
from alembic import op

revision = "0067_fixed_asset_lifecycle"
down_revision = "0066_fixed_asset_categories"
branch_labels = None
depends_on = None


def _columns(bind, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    cols = _columns(bind, "fixed_asset")
    for name, col in (
        ("state", sa.Column("state", sa.String(16), nullable=False, server_default="running")),
        ("prorata", sa.Column("prorata", sa.Boolean, nullable=False, server_default=sa.false())),
        ("base_value", sa.Column("base_value", sa.Numeric(18, 2), nullable=True)),
        ("base_months", sa.Column("base_months", sa.Integer, nullable=True)),
    ):
        if name not in cols:
            op.add_column("fixed_asset", col)
    op.execute("UPDATE fixed_asset SET state = 'closed' WHERE status = 'disposed'")
    cols = _columns(bind, "fixed_asset_category")
    for name, col in (
        ("prorata", sa.Column("prorata", sa.Boolean, nullable=False, server_default=sa.false())),
        ("auto_confirm", sa.Column("auto_confirm", sa.Boolean, nullable=False,
                                   server_default=sa.true())),
    ):
        if name not in cols:
            op.add_column("fixed_asset_category", col)
    if not sa.inspect(bind).has_table("fixed_asset_event"):
        op.create_table(
            "fixed_asset_event",
            sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
            sa.Column("asset_id", sa.BigInteger,
                      sa.ForeignKey("fixed_asset.id", ondelete="CASCADE"), nullable=False,
                      index=True),
            sa.Column("kind", sa.String(24), nullable=False),
            sa.Column("event_date", sa.Date, nullable=False),
            sa.Column("amount", sa.Numeric(18, 2), nullable=True),
            sa.Column("details", sa.String(1000), nullable=True),
            sa.Column("ledger_entry_id", sa.BigInteger, sa.ForeignKey("ledger_entry.id"),
                      nullable=True),
            sa.Column("actor_user_id", sa.BigInteger, sa.ForeignKey("user.id"), nullable=False),
            sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        )


def downgrade() -> None:
    bind = op.get_bind()
    if sa.inspect(bind).has_table("fixed_asset_event"):
        op.drop_table("fixed_asset_event")
    for table, names in (("fixed_asset", ("base_months", "base_value", "prorata", "state")),
                         ("fixed_asset_category", ("auto_confirm", "prorata"))):
        cols = _columns(bind, table)
        for name in names:
            if name in cols:
                op.drop_column(table, name)
