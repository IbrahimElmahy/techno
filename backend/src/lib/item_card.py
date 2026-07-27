"""كارت الصنف — one item's movement history with a running balance (B3).

A movement list says what happened; a stock card says what you had. The difference is the pair of
figures on every row: the balance before the movement and the balance after it. That is what lets
a storekeeper put a finger on any line and read the quantity as it stood that day, and what lets a
disputed count be traced back to the movement that caused it.

Two rules keep the card honest, and both are tested:

* A balance is only meaningful somewhere. Ask for a location and you get that location's card;
  ask for none and you get the item's whole position across every warehouse and custody.
* Filters hide rows, they never rewrite balances. Showing only sales must not pretend the
  purchases never happened — so the running balance is computed over ALL movements first, and
  the filter is applied afterwards, carrying each surviving row's true before/after with it.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.catalog import Item
from src.models.stock import LocationKind, StockDirection, StockMovement

ZERO_QTY = Decimal("0.000")


class ItemCardError(Exception):
    """The item does not exist, or the location asked for is not a real kind."""


def _qty(v) -> Decimal:
    return Decimal(str(v or 0)).quantize(Decimal("0.001"))


def _day(value: datetime | date | None) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    return value


def _parse_day(value: str | date | None) -> date | None:
    if value in (None, ""):
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    return date.fromisoformat(str(value)[:10])


def card(
    db: Session,
    *,
    item_id: int,
    location_kind: str | None = None,
    location_id: int | None = None,
    date_from: str | date | None = None,
    date_to: str | date | None = None,
    movement_type: str | None = None,
    direction: str | None = None,
) -> dict:
    item = db.get(Item, item_id)
    if item is None:
        raise ItemCardError("الصنف غير موجود.")

    kind: LocationKind | None = None
    if location_kind:
        try:
            kind = LocationKind(location_kind)
        except ValueError as exc:
            raise ItemCardError("نوع الموقع غير صحيح.") from exc
        if location_id is None:
            raise ItemCardError("لازم تحدّد الموقع مع نوعه.")

    day_from = _parse_day(date_from)
    day_to = _parse_day(date_to)

    stmt = select(StockMovement).where(StockMovement.item_id == item_id)
    if kind is not None:
        stmt = stmt.where(
            StockMovement.location_kind == kind,
            StockMovement.location_id == location_id,
        )
    # Oldest first: a card is read downwards, and the running balance only makes sense that way.
    movements = db.scalars(stmt.order_by(StockMovement.id)).all()

    names = _location_names(db)

    opening = ZERO_QTY
    rows: list[dict] = []
    balance = ZERO_QTY
    total_in = total_out = ZERO_QTY

    for mv in movements:
        signed = _qty(mv.quantity) if mv.direction == StockDirection.in_ else -_qty(mv.quantity)
        before = balance
        balance = _qty(balance + signed)

        when = _day(mv.created_at)
        # Everything before the window is carried in rather than shown — the balance the period
        # opens with. It is the same number the previous period closed on.
        if day_from is not None and when is not None and when < day_from:
            opening = balance
            continue
        if day_to is not None and when is not None and when > day_to:
            continue
        if movement_type and mv.movement_type != movement_type:
            continue
        if direction and mv.direction.value != direction:
            continue

        quantity = _qty(mv.quantity)
        is_in = mv.direction == StockDirection.in_
        total_in = _qty(total_in + quantity) if is_in else total_in
        total_out = total_out if is_in else _qty(total_out + quantity)

        loc_kind = (mv.location_kind if isinstance(mv.location_kind, str)
                    else mv.location_kind.value)
        rows.append({
            "movement_id": mv.id,
            "date": str(when) if when else None,
            "movement_type": mv.movement_type,
            "direction": mv.direction.value,
            "quantity_in": str(quantity if is_in else ZERO_QTY),
            "quantity_out": str(ZERO_QTY if is_in else quantity),
            "balance_before": str(before),
            "balance_after": str(balance),
            "location_kind": loc_kind,
            "location_id": mv.location_id,
            "location": names.get((loc_kind, mv.location_id), f"#{mv.location_id}"),
            "source_doc_type": mv.source_doc_type,
            "source_doc_id": mv.source_doc_id,
            "is_reversal": mv.reverses_movement_id is not None,
        })

    return {
        "item_id": item_id,
        "item_name": item.name,
        "item_code": item.code,
        "unit_of_measure": item.unit_of_measure,
        "location_kind": kind.value if kind else None,
        "location_id": location_id if kind else None,
        "location": (names.get((kind.value, location_id), f"#{location_id}") if kind
                     else "كل المواقع"),
        # The closing balance is the item's real position, whatever the filters hid.
        "opening_balance": str(opening),
        "closing_balance": str(balance),
        "total_in": str(total_in),
        "total_out": str(total_out),
        "rows": rows,
    }


def _location_names(db: Session) -> dict[tuple[str, int], str]:
    """Human labels for (kind, id) so a row reads «مخزن الخامات» not «warehouse #9»."""
    from src.models.user import User
    from src.models.warehouse import Custody, Warehouse

    out: dict[tuple[str, int], str] = {}
    for w in db.scalars(select(Warehouse)).all():
        out[("warehouse", w.id)] = w.name
    users = {u.id: (u.full_name or u.username) for u in db.scalars(select(User)).all()}
    for c in db.scalars(select(Custody)).all():
        out[("custody", c.id)] = f"عهدة {users.get(c.rep_id or 0, f'#{c.rep_id}')}"
    return out
