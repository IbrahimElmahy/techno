"""Reporting engine — isolated, reusable report calculators (014-production-reporting).

Library-First: each report is a function `(session, **params) -> dict` with the query + aggregation
logic in one place, reused by the `/reports/*` API and CSV export. Date bucketing (week/month/year)
is done in Python so it is DB-agnostic (identical on SQLite and Postgres). Amounts use Decimal.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money, to_qty
from src.models.catalog import Item
from src.models.manufacturing import ManufacturingOrder, ManufacturingOrderConsumption
from src.models.sales import SalesInvoice
from src.models.stock import LocationKind, StockDirection, StockMovement
from src.models.wastage import WastageDocument


# --- helpers ---------------------------------------------------------------
def _as_date(value) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return datetime.fromisoformat(str(value)[:19]).date()


def bucket_key(when: datetime | date, period: str) -> str:
    """Group a timestamp into a period bucket. period ∈ {week, month, year}."""
    d = _as_date(when)
    if period == "year":
        return f"{d.year:04d}"
    if period == "week":
        iso = d.isocalendar()
        return f"{iso[0]:04d}-W{iso[1]:02d}"
    return f"{d.year:04d}-{d.month:02d}"  # month (default)


def _in_range(when, date_from, date_to) -> bool:
    d = _as_date(when)
    if date_from and d < _as_date(date_from):
        return False
    if date_to and d > _as_date(date_to):
        return False
    return True


def _item_names(db: Session) -> dict[int, str]:
    return {i.id: i.name for i in db.scalars(select(Item)).all()}


# --- reports ---------------------------------------------------------------
def production_consumption(db: Session, *, date_from=None, date_to=None, period="month",
                           product_id: int | None = None) -> dict:
    """Actual production vs materials pulled, plus cost breakdown, bucketed by period."""
    names = _item_names(db)
    stmt = select(ManufacturingOrder).where(ManufacturingOrder.reverses_order_id.is_(None))
    if product_id is not None:
        stmt = stmt.where(ManufacturingOrder.product_id == product_id)
    rows, buckets = [], {}
    for o in db.scalars(stmt.order_by(ManufacturingOrder.id)).all():
        if not _in_range(o.created_at, date_from, date_to):
            continue
        consumed = to_qty(sum((to_qty(c.quantity) for c in o.consumptions), ZERO))
        rows.append({
            "id": o.id, "document_number": o.document_number,
            "product_id": o.product_id, "product_name": names.get(o.product_id, ""),
            "produced_quantity": str(to_qty(o.quantity)),
            "consumed_quantity": str(consumed),
            "material_cost": str(to_money(o.material_cost)),
            "resource_cost": str(to_money(o.resource_cost)),
            "total_cost": str(to_money(o.total_cost)),
            "created_at": str(o.created_at),
        })
        b = buckets.setdefault(bucket_key(o.created_at, period),
                               {"produced": ZERO, "consumed": ZERO, "total_cost": ZERO})
        b["produced"] += to_qty(o.quantity)
        b["consumed"] += consumed
        b["total_cost"] += to_money(o.total_cost)
    return {
        "rows": rows,
        "by_period": [{"period": k, "produced_quantity": str(to_qty(v["produced"])),
                       "consumed_quantity": str(to_qty(v["consumed"])),
                       "total_cost": str(to_money(v["total_cost"]))}
                      for k, v in sorted(buckets.items())],
    }


def inventory(db: Session, *, warehouse_id: int | None = None, item_id: int | None = None) -> dict:
    """Current on-hand balance and value per (item × warehouse)."""
    names = _item_names(db)
    prices = {i.id: (to_money(i.purchase_price) if i.purchase_price is not None else ZERO)
              for i in db.scalars(select(Item)).all()}
    signed = func.sum(case(
        (StockMovement.direction == StockDirection.in_, StockMovement.quantity),
        else_=-StockMovement.quantity,
    ))
    stmt = (select(StockMovement.item_id, StockMovement.location_id, signed)
            .where(StockMovement.location_kind == LocationKind.warehouse)
            .group_by(StockMovement.item_id, StockMovement.location_id))
    if warehouse_id is not None:
        stmt = stmt.where(StockMovement.location_id == warehouse_id)
    if item_id is not None:
        stmt = stmt.where(StockMovement.item_id == item_id)
    rows = []
    for iid, wid, qty in db.execute(stmt).all():
        on_hand = to_qty(qty or 0)
        if on_hand == to_qty(0):
            continue
        rows.append({
            "item_id": iid, "item_name": names.get(iid, ""), "warehouse_id": wid,
            "on_hand": str(on_hand), "unit_cost": str(prices.get(iid, ZERO)),
            "value": str(to_money(on_hand * prices.get(iid, ZERO))),
        })
    rows.sort(key=lambda r: (r["warehouse_id"], r["item_name"]))
    return {"rows": rows}


def wastage(db: Session, *, date_from=None, date_to=None, item_id: int | None = None,
            warehouse_id: int | None = None) -> dict:
    """Waste from manufacturing orders (per-line waste_quantity) + standalone wastage documents."""
    names = _item_names(db)
    prices = {i.id: (to_money(i.purchase_price) if i.purchase_price is not None else ZERO)
              for i in db.scalars(select(Item)).all()}
    rows, total_qty, total_cost = [], ZERO, ZERO

    # From manufacturing orders (non-reversal), any consumption line with waste.
    q = (select(ManufacturingOrderConsumption, ManufacturingOrder)
         .join(ManufacturingOrder, ManufacturingOrder.id == ManufacturingOrderConsumption.order_id)
         .where(ManufacturingOrder.reverses_order_id.is_(None)))
    for cons, order in db.execute(q).all():
        wq = to_qty(cons.waste_quantity)
        if wq <= to_qty(0):
            continue
        if item_id is not None and cons.item_id != item_id:
            continue
        if warehouse_id is not None and cons.warehouse_id != warehouse_id:
            continue
        if not _in_range(order.created_at, date_from, date_to):
            continue
        cost = to_money(wq * prices.get(cons.item_id, ZERO))
        total_qty += wq
        total_cost += cost
        rows.append({"source": "manufacturing", "document_number": order.document_number,
                     "item_id": cons.item_id, "item_name": names.get(cons.item_id, ""),
                     "warehouse_id": cons.warehouse_id, "quantity": str(wq),
                     "cost": str(cost), "created_at": str(order.created_at)})

    # Standalone wastage documents (exclude reversals; reversals net out).
    for d in db.scalars(select(WastageDocument).where(WastageDocument.reverses_id.is_(None))).all():
        if item_id is not None and d.item_id != item_id:
            continue
        if warehouse_id is not None and d.warehouse_id != warehouse_id:
            continue
        if not _in_range(d.created_at, date_from, date_to):
            continue
        # Skip if this document has been reversed.
        reversed_ = db.scalar(select(WastageDocument.id).where(WastageDocument.reverses_id == d.id))
        if reversed_ is not None:
            continue
        total_qty += to_qty(d.quantity)
        total_cost += to_money(d.total_cost)
        rows.append({"source": "document", "document_number": d.document_number,
                     "item_id": d.item_id, "item_name": names.get(d.item_id, ""),
                     "warehouse_id": d.warehouse_id, "quantity": str(to_qty(d.quantity)),
                     "cost": str(to_money(d.total_cost)), "created_at": str(d.created_at)})

    rows.sort(key=lambda r: r["created_at"])
    return {"rows": rows, "total_quantity": str(to_qty(total_qty)),
            "total_cost": str(to_money(total_cost))}


def stagnant_stock(db: Session, *, days: int = 90, warehouse_id: int | None = None,
                   now: datetime | None = None) -> dict:
    """Items with positive stock and no OUT movement within `days` (or never) — slow/dead stock."""
    now = now or datetime.utcnow()
    cutoff = _as_date(now) - timedelta(days=days)
    names = _item_names(db)
    prices = {i.id: (to_money(i.purchase_price) if i.purchase_price is not None else ZERO)
              for i in db.scalars(select(Item)).all()}

    # on-hand per (item, warehouse)
    signed = func.sum(case(
        (StockMovement.direction == StockDirection.in_, StockMovement.quantity),
        else_=-StockMovement.quantity,
    ))
    on_hand_stmt = (select(StockMovement.item_id, StockMovement.location_id, signed)
                    .where(StockMovement.location_kind == LocationKind.warehouse)
                    .group_by(StockMovement.item_id, StockMovement.location_id))
    if warehouse_id is not None:
        on_hand_stmt = on_hand_stmt.where(StockMovement.location_id == warehouse_id)

    rows = []
    for iid, wid, qty in db.execute(on_hand_stmt).all():
        on_hand = to_qty(qty or 0)
        if on_hand <= to_qty(0):
            continue
        last_out = db.scalar(
            select(func.max(StockMovement.created_at)).where(
                StockMovement.item_id == iid, StockMovement.location_id == wid,
                StockMovement.location_kind == LocationKind.warehouse,
                StockMovement.direction == StockDirection.out,
            ))
        last_out_date = _as_date(last_out) if last_out is not None else None
        if last_out_date is not None and last_out_date >= cutoff:
            continue  # moved recently — not stagnant
        rows.append({
            "item_id": iid, "item_name": names.get(iid, ""), "warehouse_id": wid,
            "on_hand": str(on_hand), "last_out_date": str(last_out_date) if last_out_date else None,
            "value": str(to_money(on_hand * prices.get(iid, ZERO))),
        })
    rows.sort(key=lambda r: (r["last_out_date"] or "", r["item_name"]))
    return {"days": days, "as_of": str(_as_date(now)), "rows": rows}


def sales(db: Session, *, date_from=None, date_to=None, period="month") -> dict:
    """Sales gross/net bucketed by period (for linking sales volume to production)."""
    rows, buckets = [], {}
    gross_total = net_total = ZERO
    for inv in db.scalars(select(SalesInvoice).order_by(SalesInvoice.id)).all():
        if not _in_range(inv.created_at, date_from, date_to):
            continue
        gross_total += to_money(inv.gross)
        net_total += to_money(inv.net)
        rows.append({"document_number": inv.document_number, "customer_id": inv.customer_id,
                     "gross": str(to_money(inv.gross)), "net": str(to_money(inv.net)),
                     "created_at": str(inv.created_at)})
        b = buckets.setdefault(bucket_key(inv.created_at, period), {"gross": ZERO, "net": ZERO})
        b["gross"] += to_money(inv.gross)
        b["net"] += to_money(inv.net)
    return {
        "rows": rows, "gross_total": str(to_money(gross_total)), "net_total": str(to_money(net_total)),
        "by_period": [{"period": k, "gross": str(to_money(v["gross"])), "net": str(to_money(v["net"]))}
                      for k, v in sorted(buckets.items())],
    }
