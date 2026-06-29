"""Five sale price tiers — additive to 002 (T017).

Creates the `item_price` table and adds the `default_price_tier` / `price_tier` enum columns to
`customer` and `sales_invoice_line`. No 001–006 table is dropped or redefined; no backfill (items keep
pricing via `item.sale_price`; existing lines keep `unit_price`, `price_tier` NULL).
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

import src.models  # noqa: F401  (populate metadata)

revision = "0006_price_tiers"
down_revision = "0005_cost_centers"
branch_labels = None
depends_on = None

_TIER_ENUM = (
    "ENUM('commercial','semi_commercial','wholesale','semi_wholesale','consumer')"
)


def _tier_col(nullable: bool = True):
    # MySQL gets a native ENUM; SQLite (tests) uses VARCHAR via the SQLAlchemy Enum fallback.
    return sa.Column(
        "tier",
        sa.Enum(
            "commercial", "semi_commercial", "wholesale", "semi_wholesale", "consumer",
            name="pricetier",
        ),
        nullable=nullable,
    )


def upgrade() -> None:
    bind = op.get_bind()
    is_mysql = bind.dialect.name in ("mysql", "mariadb")

    op.create_table(
        "item_price",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("item_id", sa.BigInteger(), nullable=False),
        _tier_col(nullable=False),
        sa.Column("price", sa.Numeric(18, 2), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("item_id", "tier", name="uq_item_price_item_tier"),
        sa.ForeignKeyConstraint(["item_id"], ["item.id"], name="fk_item_price_item"),
    )
    op.create_index("ix_item_price_item_id", "item_price", ["item_id"])

    if is_mysql:
        op.execute(f"ALTER TABLE customer ADD COLUMN default_price_tier {_TIER_ENUM} NULL")
        op.execute(f"ALTER TABLE sales_invoice_line ADD COLUMN price_tier {_TIER_ENUM} NULL")
    else:
        _enum = sa.Enum(
            "commercial", "semi_commercial", "wholesale", "semi_wholesale", "consumer",
            name="pricetier",
        )
        op.add_column("customer", sa.Column("default_price_tier", _enum, nullable=True))
        op.add_column("sales_invoice_line", sa.Column("price_tier", _enum, nullable=True))


def downgrade() -> None:
    op.drop_column("sales_invoice_line", "price_tier")
    op.drop_column("customer", "default_price_tier")
    op.drop_index("ix_item_price_item_id", table_name="item_price")
    op.drop_table("item_price")
