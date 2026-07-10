"""Manufacturing BOM — additive to 002 (012-manufacturing-bom).

Adds recipes (`bom`, `bom_component`) and recipe-driven production documents
(`manufacturing_order`, `manufacturing_order_consumption`). No existing table is dropped or
redefined; the decoupled `manufacturing_op` primitive is kept. Stock/money invariants unchanged
(orders post quantity-only movements and no ledger entry).
"""
from __future__ import annotations

from alembic import op

from src.core.db import Base
import src.models  # noqa: F401  (populate metadata)

revision = "0010_manufacturing_bom"
down_revision = "0009_barcodes"
branch_labels = None
depends_on = None

_NEW_TABLES = [
    "bom",
    "bom_component",
    "manufacturing_order",
    "manufacturing_order_consumption",
]


def _tables():
    return [Base.metadata.tables[name] for name in _NEW_TABLES]


def upgrade() -> None:
    Base.metadata.create_all(bind=op.get_bind(), tables=_tables())


def downgrade() -> None:
    Base.metadata.drop_all(bind=op.get_bind(), tables=list(reversed(_tables())))
