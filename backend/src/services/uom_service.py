from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.money import to_factor, to_qty
from src.models.catalog import Item, ItemUnit

ONE = Decimal("1")

METER = "متر"
PIECE = "قطعة"
_PIECE_NAMES = {"قطعة", "قطعه"}


def _norm(label: str | None) -> str:
    return (label or "").strip()


def is_meter_unit(label: str | None) -> bool:
    t = _norm(label)
    return t == "م" or t.startswith("متر")


def length_unit(base_unit: str, meters_per_piece: Decimal) -> tuple[str, Decimal]:
    n = Decimal(str(meters_per_piece))
    if n <= 0:
        raise UomError("طول القطعة لازم يكون أكبر من صفر.")
    if is_meter_unit(base_unit):
        return PIECE, to_factor(n)
    return METER, to_factor(ONE / n)


def _is_length_row(base_unit: str, name: str) -> bool:
    if is_meter_unit(base_unit):
        return _norm(name) in _PIECE_NAMES
    return is_meter_unit(name)


def meters_per_piece(base_unit: str, rows) -> Decimal | None:
    for r in rows:
        f = Decimal(str(r.factor or 0))
        if f > 0 and _is_length_row(base_unit, r.name):
            return to_qty(f if is_meter_unit(base_unit) else ONE / f)
    return None


def apply_length(db: Session, item: Item, length: Decimal | None) -> None:
    base = item.unit_of_measure
    kept: list[str] = []
    for r in db.scalars(select(ItemUnit).where(ItemUnit.item_id == item.id)).all():
        name = _norm(r.name)
        if (is_meter_unit(name) or name == _norm(base)
                or (is_meter_unit(base) and name in _PIECE_NAMES)):
            db.delete(r)
        else:
            kept.append(name)
    db.flush()
    if length is None or Decimal(str(length)) <= 0:
        return
    name, factor = length_unit(base, Decimal(str(length)))
    if name in kept:
        raise UomError(f"الصنف عليه وحدة اسمها «{name}» بالفعل.")
    db.add(ItemUnit(item_id=item.id, name=name, factor=factor))
    db.flush()


class UomError(Exception):
    pass


def resolve_factor(db: Session, item: Item, unit: str | None) -> Decimal:
    if unit is None or unit == item.unit_of_measure:
        return ONE
    row = db.scalar(
        select(ItemUnit).where(ItemUnit.item_id == item.id, ItemUnit.name == unit)
    )
    if row is None:
        raise UomError(f"الوحدة «{unit}» مش معرّفة للصنف ده.")
    return to_factor(row.factor)
