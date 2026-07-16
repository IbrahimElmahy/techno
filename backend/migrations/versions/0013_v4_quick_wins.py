"""v4 quick wins — additive.

New table: contact_phone (extra numbers for customers/suppliers).
New columns: item.category; supplier.address; customer.governorate_id/markaz/address.
Type change: point values/deltas become fractional (NUMERIC) so a product can be worth e.g. 1/6
of a point (client: "6 pieces = 1 point").
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

import src.models  # noqa: F401  (populate metadata)
from src.core.db import Base

revision = "0013_v4_quick_wins"
down_revision = "0012_production_reporting"
branch_labels = None
depends_on = None

_NEW_TABLES = ["contact_phone"]


def _tables():
    return [Base.metadata.tables[name] for name in _NEW_TABLES]


def upgrade() -> None:
    Base.metadata.create_all(bind=op.get_bind(), tables=_tables())
    op.add_column("item", sa.Column("category", sa.String(length=80), nullable=True))
    op.create_index("ix_item_category", "item", ["category"])
    op.add_column("supplier", sa.Column("address", sa.String(length=240), nullable=True))
    op.add_column("customer", sa.Column("governorate_id", sa.BigInteger(), nullable=True))
    op.add_column("customer", sa.Column("markaz", sa.String(length=120), nullable=True))
    op.add_column("customer", sa.Column("address", sa.String(length=240), nullable=True))
    # Fractional points (v4).
    op.alter_column("product_point_value", "point_value",
                    type_=sa.Numeric(18, 3), existing_nullable=False)
    op.alter_column("point_record", "delta", type_=sa.Numeric(18, 3), existing_nullable=False)


def downgrade() -> None:
    op.alter_column("point_record", "delta", type_=sa.BigInteger(), existing_nullable=False)
    op.alter_column("product_point_value", "point_value",
                    type_=sa.BigInteger(), existing_nullable=False)
    op.drop_column("customer", "address")
    op.drop_column("customer", "markaz")
    op.drop_column("customer", "governorate_id")
    op.drop_column("supplier", "address")
    op.drop_index("ix_item_category", table_name="item")
    op.drop_column("item", "category")
    Base.metadata.drop_all(bind=op.get_bind(), tables=list(reversed(_tables())))
