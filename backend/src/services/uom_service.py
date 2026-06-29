"""Units of measure (008, T005).

Resolves a document line's unit to a conversion factor (base units per one of the chosen unit). The
base unit is item.unit_of_measure with an implicit factor of 1; alternates live in item_unit. Stock is
always posted in the base unit = entered quantity × factor.
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.money import to_qty
from src.models.catalog import Item, ItemUnit

ONE = Decimal("1")


class UomError(Exception):
    """Unknown unit for an item."""


def resolve_factor(db: Session, item: Item, unit: str | None) -> Decimal:
    """Base/None → 1; an alternate unit → its factor; otherwise UomError."""
    if unit is None or unit == item.unit_of_measure:
        return ONE
    row = db.scalar(
        select(ItemUnit).where(ItemUnit.item_id == item.id, ItemUnit.name == unit)
    )
    if row is None:
        raise UomError(f"Unit '{unit}' is not defined for item {item.id}.")
    return to_qty(row.factor)
