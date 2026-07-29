"""جرد حق تاريخ — the stock as it stood on a past date (B5).

"What did you have on the 31st" cannot be answered from today's balance. It is the same
derivation the on-hand figure uses, cut off at a date: every movement up to and including that
day, nothing after it. Two consequences worth stating, because both are the point:

* A document entered late still lands on the day it happened, so the count for a closed month
  does not depend on when someone got round to typing it.
* The answer for a past date never drifts as later months trade — the movements behind it are
  immutable, so the same question always gives the same number.

Valued at the configured costing method (نوع التكلفة). The value is an estimate of what the
stock is worth *now* at that cost, not a frozen historical valuation — freezing that would need
per-receipt cost layers, which is a data change and not a report.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from src.core import clock
from src.core.money import ZERO, to_money
from src.models.catalog import Item
from src.models.stock import LocationKind, StockDirection, StockMovement
from src.services import costing_service

ZERO_QTY = Decimal("0.000")


def _qty(v) -> Decimal:
    return Decimal(str(v or 0)).quantize(Decimal("0.001"))


def stock_as_of(
    db: Session,
    *,
    as_of: str | date | None = None,
    warehouse_id: int | None = None,
    item_id: int | None = None,
) -> dict:
    day = None
    if as_of:
        day = as_of if isinstance(as_of, date) else date.fromisoformat(str(as_of)[:10])

    signed = case(
        (StockMovement.direction == StockDirection.in_, StockMovement.quantity),
        else_=-StockMovement.quantity,
    )
    stmt = (
        select(
            StockMovement.item_id,
            StockMovement.location_kind,
            StockMovement.location_id,
            func.coalesce(func.sum(signed), 0),
        )
        .group_by(StockMovement.item_id, StockMovement.location_kind,
                  StockMovement.location_id)
    )
    if day is not None:
        # Compared against the UTC instant the business day ends, not against `date()` of a
        # UTC timestamp — those differ by the office's offset every night after midnight.
        stmt = stmt.where(StockMovement.created_at < clock.day_end_utc(day))
    if warehouse_id is not None:
        stmt = stmt.where(StockMovement.location_kind == LocationKind.warehouse,
                          StockMovement.location_id == warehouse_id)
    if item_id is not None:
        stmt = stmt.where(StockMovement.item_id == item_id)

    raw = db.execute(stmt).all()
    if not raw:
        return _empty(day, warehouse_id)

    items = {
        i.id: i for i in db.scalars(
            select(Item).where(Item.id.in_({r[0] for r in raw}))).all()
    }
    names = _location_names(db)
    costs: dict[int, Decimal] = {}

    rows: list[dict] = []
    total_qty = ZERO_QTY
    total_value = ZERO
    for item_ref, kind, loc_id, quantity in raw:
        held = _qty(quantity)
        # A stocktake lists what is there. A zero line is noise on a count sheet — and a negative
        # one cannot exist, because no movement is allowed to create it.
        if held <= ZERO_QTY:
            continue
        item = items.get(item_ref)
        if item_ref not in costs:
            costs[item_ref] = costing_service.unit_cost(db, item_ref)
        cost = costs[item_ref]
        value = to_money(held * cost)
        loc_kind = kind if isinstance(kind, str) else kind.value
        rows.append({
            "item_id": item_ref,
            "code": item.code if item else None,
            "name": item.name if item else f"#{item_ref}",
            "unit_of_measure": item.unit_of_measure if item else None,
            "location_kind": loc_kind,
            "location_id": loc_id,
            "location": names.get((loc_kind, loc_id), f"#{loc_id}"),
            "quantity": str(held),
            "unit_cost": str(cost),
            "value": str(value),
        })
        total_qty = _qty(total_qty + held)
        total_value = to_money(total_value + value)

    rows.sort(key=lambda r: (r["name"], r["location"]))
    return {
        "as_of": str(day) if day else None,
        "warehouse_id": warehouse_id,
        "costing_method": costing_service.costing_method(db).value,
        "rows": rows,
        "totals": {"quantity": str(total_qty), "value": str(total_value),
                   "lines": len(rows)},
    }


def _empty(day: date | None, warehouse_id: int | None) -> dict:
    return {
        "as_of": str(day) if day else None, "warehouse_id": warehouse_id,
        "costing_method": None, "rows": [],
        "totals": {"quantity": str(ZERO_QTY), "value": str(ZERO), "lines": 0},
    }


def _location_names(db: Session) -> dict[tuple[str, int], str]:
    from src.models.user import User
    from src.models.warehouse import Custody, Warehouse

    out: dict[tuple[str, int], str] = {}
    for w in db.scalars(select(Warehouse)).all():
        out[("warehouse", w.id)] = w.name
    users = {u.id: (u.full_name or u.username) for u in db.scalars(select(User)).all()}
    for c in db.scalars(select(Custody)).all():
        out[("custody", c.id)] = f"عهدة {users.get(c.rep_id or 0, f'#{c.rep_id}')}"
    return out
