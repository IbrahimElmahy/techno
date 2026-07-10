"""Production costing + routing + wastage — additive (014-production-reporting).

New tables: bom_resource, manufacturing_order_resource, wastage_document.
New columns: item.default_warehouse_id; manufacturing_order.material_cost/resource_cost;
manufacturing_order_consumption.waste_quantity/warehouse_id. No existing data is dropped.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

import src.models  # noqa: F401  (populate metadata)
from src.core.db import Base

revision = "0012_production_reporting"
down_revision = "0011_lookups"
branch_labels = None
depends_on = None

_NEW_TABLES = ["bom_resource", "manufacturing_order_resource", "wastage_document"]


def _tables():
    return [Base.metadata.tables[name] for name in _NEW_TABLES]


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind, tables=_tables())
    op.add_column("item", sa.Column("default_warehouse_id", sa.BigInteger(), nullable=True))
    op.add_column("manufacturing_order",
                  sa.Column("material_cost", sa.Numeric(18, 2), nullable=False, server_default="0"))
    op.add_column("manufacturing_order",
                  sa.Column("resource_cost", sa.Numeric(18, 2), nullable=False, server_default="0"))
    op.add_column("manufacturing_order_consumption",
                  sa.Column("waste_quantity", sa.Numeric(18, 3), nullable=False, server_default="0"))
    op.add_column("manufacturing_order_consumption",
                  sa.Column("warehouse_id", sa.BigInteger(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    op.drop_column("manufacturing_order_consumption", "warehouse_id")
    op.drop_column("manufacturing_order_consumption", "waste_quantity")
    op.drop_column("manufacturing_order", "resource_cost")
    op.drop_column("manufacturing_order", "material_cost")
    op.drop_column("item", "default_warehouse_id")
    Base.metadata.drop_all(bind=bind, tables=list(reversed(_tables())))
