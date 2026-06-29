"""Barcode registry + lookup service (010).

Globally-unique barcodes per item, each optionally tied to a unit (008). The lookup reuses the 008
factor resolver so a scanned "carton barcode" yields the carton factor. Read-only on lookup.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from src.core.money import to_qty
from src.models.catalog import Item, ItemBarcode, ItemUnit
from src.services import uom_service


class BarcodeError(Exception):
    """Invalid barcode operation (duplicate barcode, unknown unit)."""


@dataclass(frozen=True)
class BarcodeInput:
    barcode: str
    unit: str | None = None


@dataclass(frozen=True)
class BarcodeLookup:
    item_id: int
    code: str
    name: str
    unit: str | None
    factor: Decimal
    base_sale_price: Decimal | None


def _valid_unit(db: Session, item: Item, unit: str | None) -> bool:
    if unit is None or unit == item.unit_of_measure:
        return True
    return db.scalar(
        select(ItemUnit.id).where(ItemUnit.item_id == item.id, ItemUnit.name == unit)
    ) is not None


def set_barcodes(db: Session, *, item: Item, barcodes: list[BarcodeInput]) -> list[ItemBarcode]:
    """Replace the item's barcode set. Global-unique; unit must be base or a defined alternate."""
    codes = [b.barcode.strip() for b in barcodes]
    if any(not c for c in codes):
        raise BarcodeError("Barcode cannot be empty.")
    if len(set(codes)) != len(codes):
        raise BarcodeError("Duplicate barcode in the request.")
    for b in barcodes:
        if not _valid_unit(db, item, b.unit):
            raise BarcodeError(f"Unit '{b.unit}' is not defined for this item.")
        owner = db.scalar(select(ItemBarcode).where(ItemBarcode.barcode == b.barcode.strip()))
        if owner is not None and owner.item_id != item.id:
            raise BarcodeError(f"Barcode '{b.barcode}' is already used by another item.")
    # Replace the full set for this item.
    db.execute(delete(ItemBarcode).where(ItemBarcode.item_id == item.id))
    rows = [ItemBarcode(item_id=item.id, barcode=b.barcode.strip(), unit=b.unit) for b in barcodes]
    db.add_all(rows)
    db.flush()
    return rows


def lookup(db: Session, barcode: str) -> BarcodeLookup | None:
    """Resolve a scanned code to item + unit + factor (008). None if unknown (→ 404)."""
    row = db.scalar(select(ItemBarcode).where(ItemBarcode.barcode == barcode))
    if row is None:
        return None
    item = db.get(Item, row.item_id)
    factor = to_qty(uom_service.resolve_factor(db, item, row.unit))
    return BarcodeLookup(
        item_id=item.id, code=item.code, name=item.name, unit=row.unit, factor=factor,
        base_sale_price=item.sale_price,
    )
