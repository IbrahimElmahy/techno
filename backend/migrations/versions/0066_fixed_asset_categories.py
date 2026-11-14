"""فئات الأصول الثابتة، والأصول القديمة، وفاتورة شراء الأصول.

Revision ID: 0066_fixed_asset_categories
Revises: 0065_point_record_purse
"""
import sqlalchemy as sa
from alembic import op

revision = "0066_fixed_asset_categories"
down_revision = "0065_point_record_purse"
branch_labels = None
depends_on = None


def _columns(bind, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("fixed_asset_category"):
        op.create_table(
            "fixed_asset_category",
            sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
            sa.Column("name", sa.String(80), nullable=False, unique=True),
            sa.Column("method", sa.String(24), nullable=False, server_default="straight_line"),
            sa.Column("annual_rate", sa.Numeric(5, 2), nullable=True),
            sa.Column("useful_life_months", sa.Integer, nullable=True),
            sa.Column("usage", sa.String(16), nullable=False, server_default="admin"),
            sa.Column("active", sa.Boolean, nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        )
    cols = _columns(bind, "fixed_asset")
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TABLE fixed_asset ALTER COLUMN method TYPE varchar(24) "
                   "USING method::text")
    else:
        op.alter_column("fixed_asset", "method", type_=sa.String(24))
    for name, col in (
        ("category_id", sa.Column("category_id", sa.BigInteger,
                                  sa.ForeignKey("fixed_asset_category.id"), nullable=True)),
        ("usage", sa.Column("usage", sa.String(16), nullable=False, server_default="admin")),
        ("annual_rate", sa.Column("annual_rate", sa.Numeric(5, 2), nullable=True)),
        ("opening_accumulated", sa.Column("opening_accumulated", sa.Numeric(18, 2),
                                          nullable=False, server_default="0")),
        ("depreciation_start", sa.Column("depreciation_start", sa.Date, nullable=True)),
        ("source_kind", sa.Column("source_kind", sa.String(24), nullable=True)),
        ("source_id", sa.Column("source_id", sa.BigInteger, nullable=True)),
    ):
        if name not in cols:
            op.add_column("fixed_asset", col)
    if "invoice_type" not in _columns(bind, "purchase_invoice"):
        op.add_column("purchase_invoice", sa.Column(
            "invoice_type", sa.String(16), nullable=False, server_default="items"))


def downgrade() -> None:
    bind = op.get_bind()
    if "invoice_type" in _columns(bind, "purchase_invoice"):
        op.drop_column("purchase_invoice", "invoice_type")
    cols = _columns(bind, "fixed_asset")
    for name in ("source_id", "source_kind", "depreciation_start", "opening_accumulated",
                 "annual_rate", "usage", "category_id"):
        if name in cols:
            op.drop_column("fixed_asset", name)
    if sa.inspect(bind).has_table("fixed_asset_category"):
        op.drop_table("fixed_asset_category")
