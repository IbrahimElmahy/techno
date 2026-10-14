from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from sqlalchemy import Date, and_, case, cast, func, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money, to_qty
from src.models.catalog import Item
from src.models.purchasing import (
    PurchaseInvoice,
    PurchaseInvoiceLine,
    PurchaseReturn,
    PurchaseReturnLine,
)
from src.models.stock import LocationKind, StockDirection, StockMovement
from src.models.warehouse import Warehouse

COST_BASES = ("average", "list_factor")


@dataclass
class Valuation:
    as_of: date
    branch_id: int | None
    cost_basis: str
    total: Decimal = ZERO
    by_category: dict[str, Decimal] = field(default_factory=dict)
    rows: list[dict] = field(default_factory=list)
    missing_cost: int = 0
    negative_rows: int = 0
    excluded_value: Decimal = ZERO

    def as_dict(self, *, with_rows: bool = True) -> dict:
        out = {
            "as_of": self.as_of.isoformat(), "branch_id": self.branch_id,
            "cost_basis": self.cost_basis, "total": str(self.total),
            "by_category": {k: str(v) for k, v in sorted(
                self.by_category.items(), key=lambda kv: -kv[1])},
            "missing_cost": self.missing_cost, "negative_rows": self.negative_rows,
            "excluded_value": str(self.excluded_value),
        }
        if with_rows:
            out["rows"] = self.rows
        return out


def branch_warehouse_ids(db: Session, branch_id: int | None) -> list[int] | None:
    if branch_id is None:
        return None
    return list(db.scalars(select(Warehouse.id).where(Warehouse.branch_id == branch_id)).all())


def quantities_at(db: Session, *, branch_id: int | None,
                  as_of: date) -> dict[tuple[int, int], Decimal]:
    when = func.coalesce(StockMovement.movement_date, cast(StockMovement.created_at, Date))
    signed = func.sum(case(
        (StockMovement.direction == StockDirection.in_, StockMovement.quantity),
        else_=-StockMovement.quantity,
    ))
    stmt = (select(StockMovement.item_id, StockMovement.location_id, signed)
            .where(StockMovement.location_kind == LocationKind.warehouse, when <= as_of)
            .group_by(StockMovement.item_id, StockMovement.location_id))
    mine = branch_warehouse_ids(db, branch_id)
    if mine is not None:
        stmt = stmt.where(StockMovement.location_id.in_(mine or [-1]))
    out: dict[tuple[int, int], Decimal] = {}
    for item_id, wh_id, qty in db.execute(stmt).all():
        q = to_qty(qty or 0)
        if q != to_qty(0):
            out[(item_id, wh_id)] = q
    return out


def average_cost_at(db: Session, item_ids, *, as_of: date,
                    branch_id: int | None) -> dict[int, Decimal]:
    ids = list({int(i) for i in item_ids})
    if not ids:
        return {}
    after_doc = 1 - func.coalesce(PurchaseInvoice.combined_pct, 0) / 100
    bought_stmt = (
        select(PurchaseInvoiceLine.item_id,
               func.coalesce(func.sum(
                   PurchaseInvoiceLine.quantity * PurchaseInvoiceLine.unit_factor), 0),
               func.coalesce(func.sum(PurchaseInvoiceLine.line_total * after_doc), 0))
        .join(PurchaseInvoice, PurchaseInvoice.id == PurchaseInvoiceLine.invoice_id)
        .where(PurchaseInvoiceLine.item_id.in_(ids),
               func.coalesce(PurchaseInvoice.purchase_date,
                             cast(PurchaseInvoice.created_at, Date)) <= as_of)
        .group_by(PurchaseInvoiceLine.item_id)
    )
    if branch_id is not None:
        bought_stmt = bought_stmt.where(PurchaseInvoice.branch_id == branch_id)
    bought = {i: (Decimal(str(q or 0)), Decimal(str(v or 0)))
              for i, q, v in db.execute(bought_stmt).all()}

    returned_stmt = (
        select(PurchaseReturnLine.item_id,
               func.coalesce(func.sum(PurchaseReturnLine.quantity), 0),
               func.coalesce(func.sum(
                   PurchaseReturnLine.quantity * PurchaseInvoiceLine.unit_price
                   * (1 - func.coalesce(PurchaseInvoiceLine.discount_pct, 0) / 100)
                   * after_doc), 0))
        .select_from(PurchaseReturnLine)
        .join(PurchaseReturn, PurchaseReturn.id == PurchaseReturnLine.return_id)
        .join(PurchaseInvoice, PurchaseInvoice.id == PurchaseReturn.purchase_invoice_id)
        .join(PurchaseInvoiceLine, and_(
            PurchaseInvoiceLine.invoice_id == PurchaseInvoice.id,
            PurchaseInvoiceLine.item_id == PurchaseReturnLine.item_id))
        .where(PurchaseReturnLine.item_id.in_(ids), PurchaseReturn.reversed_at.is_(None),
               func.coalesce(PurchaseReturn.return_date,
                             cast(PurchaseReturn.created_at, Date)) <= as_of)
        .group_by(PurchaseReturnLine.item_id)
    )
    if branch_id is not None:
        returned_stmt = returned_stmt.where(PurchaseReturn.branch_id == branch_id)
    returned = {i: (Decimal(str(q or 0)), Decimal(str(v or 0)))
                for i, q, v in db.execute(returned_stmt).all()}

    out: dict[int, Decimal] = {}
    for item_id in ids:
        b_q, b_v = bought.get(item_id, (ZERO, ZERO))
        r_q, r_v = returned.get(item_id, (ZERO, ZERO))
        if b_q - r_q > 0:
            out[item_id] = (b_v - r_v) / (b_q - r_q)
    return out


def quantities_many(db: Session, *, branch_id: int | None,
                    dates: list[date]) -> dict[date, dict[tuple[int, int], Decimal]]:
    when = func.coalesce(StockMovement.movement_date, cast(StockMovement.created_at, Date))
    signed = case(
        (StockMovement.direction == StockDirection.in_, StockMovement.quantity),
        else_=-StockMovement.quantity,
    )
    cols = [func.sum(case((when <= d, signed), else_=0)) for d in dates]
    stmt = (select(StockMovement.item_id, StockMovement.location_id, *cols)
            .where(StockMovement.location_kind == LocationKind.warehouse, when <= max(dates))
            .group_by(StockMovement.item_id, StockMovement.location_id))
    mine = branch_warehouse_ids(db, branch_id)
    if mine is not None:
        stmt = stmt.where(StockMovement.location_id.in_(mine or [-1]))
    out: dict[date, dict[tuple[int, int], Decimal]] = {d: {} for d in dates}
    for item_id, wh_id, *qtys in db.execute(stmt).all():
        for d, qty in zip(dates, qtys, strict=True):
            q = to_qty(qty or 0)
            if q != to_qty(0):
                out[d][(item_id, wh_id)] = q
    return out


def average_cost_many(db: Session, item_ids, *, dates: list[date],
                      branch_id: int | None) -> dict[date, dict[int, Decimal]]:
    ids = list({int(i) for i in item_ids})
    if not ids:
        return {d: {} for d in dates}
    after_doc = 1 - func.coalesce(PurchaseInvoice.combined_pct, 0) / 100
    p_date = func.coalesce(PurchaseInvoice.purchase_date, cast(PurchaseInvoice.created_at, Date))
    b_qty = PurchaseInvoiceLine.quantity * PurchaseInvoiceLine.unit_factor
    b_val = PurchaseInvoiceLine.line_total * after_doc
    bought_cols = []
    for d in dates:
        bought_cols += [func.sum(case((p_date <= d, b_qty), else_=0)),
                        func.sum(case((p_date <= d, b_val), else_=0))]
    bought_stmt = (
        select(PurchaseInvoiceLine.item_id, *bought_cols)
        .join(PurchaseInvoice, PurchaseInvoice.id == PurchaseInvoiceLine.invoice_id)
        .where(PurchaseInvoiceLine.item_id.in_(ids), p_date <= max(dates))
        .group_by(PurchaseInvoiceLine.item_id)
    )
    if branch_id is not None:
        bought_stmt = bought_stmt.where(PurchaseInvoice.branch_id == branch_id)

    r_date = func.coalesce(PurchaseReturn.return_date, cast(PurchaseReturn.created_at, Date))
    r_qty = PurchaseReturnLine.quantity
    r_val = (PurchaseReturnLine.quantity * PurchaseInvoiceLine.unit_price
             * (1 - func.coalesce(PurchaseInvoiceLine.discount_pct, 0) / 100) * after_doc)
    returned_cols = []
    for d in dates:
        returned_cols += [func.sum(case((r_date <= d, r_qty), else_=0)),
                          func.sum(case((r_date <= d, r_val), else_=0))]
    returned_stmt = (
        select(PurchaseReturnLine.item_id, *returned_cols)
        .select_from(PurchaseReturnLine)
        .join(PurchaseReturn, PurchaseReturn.id == PurchaseReturnLine.return_id)
        .join(PurchaseInvoice, PurchaseInvoice.id == PurchaseReturn.purchase_invoice_id)
        .join(PurchaseInvoiceLine, and_(
            PurchaseInvoiceLine.invoice_id == PurchaseInvoice.id,
            PurchaseInvoiceLine.item_id == PurchaseReturnLine.item_id))
        .where(PurchaseReturnLine.item_id.in_(ids), PurchaseReturn.reversed_at.is_(None),
               r_date <= max(dates))
        .group_by(PurchaseReturnLine.item_id)
    )
    if branch_id is not None:
        returned_stmt = returned_stmt.where(PurchaseReturn.branch_id == branch_id)

    def pairs(row) -> list[tuple[Decimal, Decimal]]:
        vals = [Decimal(str(v or 0)) for v in row]
        return [(vals[2 * k], vals[2 * k + 1]) for k in range(len(dates))]

    bought = {r[0]: pairs(r[1:]) for r in db.execute(bought_stmt).all()}
    returned = {r[0]: pairs(r[1:]) for r in db.execute(returned_stmt).all()}
    empty = [(ZERO, ZERO)] * len(dates)
    out: dict[date, dict[int, Decimal]] = {d: {} for d in dates}
    for item_id in ids:
        b, r = bought.get(item_id, empty), returned.get(item_id, empty)
        for k, d in enumerate(dates):
            (b_q, b_v), (r_q, r_v) = b[k], r[k]
            if b_q - r_q > 0:
                out[d][item_id] = (b_v - r_v) / (b_q - r_q)
    return out


def _valuate(*, as_of: date, branch_id: int | None, cost_basis: str, qtys, items, avg,
             excluded: set[str], factors: dict[str, Decimal], wh_names: dict,
             with_rows: bool) -> Valuation:
    out = Valuation(as_of=as_of, branch_id=branch_id, cost_basis=cost_basis)
    no_cost: set[int] = set()
    for (iid, wid), qty in qtys.items():
        item = items.get(iid)
        category = (item.category if item else None) or "بدون فئة"
        unit, source = None, None
        factor = factors.get(category)
        if cost_basis == "list_factor" and factor is not None and item is not None \
                and item.sale_price is not None and Decimal(str(item.sale_price)) > 0:
            unit, source = Decimal(str(item.sale_price)) * factor / 100, "list_factor"
        if unit is None and iid in avg:
            unit, source = avg[iid], "average"
        if unit is None and item is not None and item.purchase_price is not None:
            unit, source = Decimal(str(item.purchase_price)), "item_purchase_price"
        if unit is None:
            unit, source = ZERO, "none"
            no_cost.add(iid)
        value = to_money(qty * unit)
        if category in excluded:
            out.excluded_value += value
            continue
        if qty < 0:
            out.negative_rows += 1
        out.total += value
        out.by_category[category] = out.by_category.get(category, ZERO) + value
        if with_rows:
            out.rows.append({
                "item_id": iid, "item_code": item.code if item else None,
                "item_name": item.name if item else None, "category": category,
                "warehouse_id": wid, "warehouse_name": wh_names.get(wid),
                "quantity": str(qty), "unit_cost": str(to_money(unit)),
                "cost_source": source, "value": str(value),
            })
    out.total = to_money(out.total)
    out.excluded_value = to_money(out.excluded_value)
    out.missing_cost = len(no_cost)
    if with_rows:
        out.rows.sort(key=lambda r: (r["category"], r["item_name"] or "", r["warehouse_id"]))
    return out


def _options(cost_basis: str, exclude_categories, list_factors) -> tuple[str, set[str], dict]:
    if cost_basis not in COST_BASES:
        cost_basis = "average"
    excluded = {str(c) for c in (exclude_categories or ())}
    factors = {str(k): Decimal(str(v)) for k, v in (list_factors or {}).items()
               if v not in (None, "")}
    return cost_basis, excluded, factors


def value_at(
    db: Session, *, branch_id: int | None, as_of: date, cost_basis: str = "average",
    exclude_categories=(), list_factors: dict[str, Decimal | float | str] | None = None,
    with_rows: bool = True,
) -> Valuation:
    cost_basis, excluded, factors = _options(cost_basis, exclude_categories, list_factors)
    qtys = quantities_at(db, branch_id=branch_id, as_of=as_of)
    item_ids = {iid for iid, _ in qtys}
    items = {i.id: i for i in db.scalars(select(Item).where(Item.id.in_(item_ids or [-1]))).all()}
    avg = average_cost_at(db, item_ids, as_of=as_of, branch_id=branch_id)
    wh_names = dict(db.execute(select(Warehouse.id, Warehouse.name)).all())
    return _valuate(as_of=as_of, branch_id=branch_id, cost_basis=cost_basis, qtys=qtys,
                    items=items, avg=avg, excluded=excluded, factors=factors,
                    wh_names=wh_names, with_rows=with_rows)


def values_at(
    db: Session, *, branch_id: int | None, dates: list[date], cost_basis: str = "average",
    exclude_categories=(), list_factors: dict[str, Decimal | float | str] | None = None,
) -> dict[date, Valuation]:
    dates = sorted(set(dates))
    if not dates:
        return {}
    cost_basis, excluded, factors = _options(cost_basis, exclude_categories, list_factors)
    qtys = quantities_many(db, branch_id=branch_id, dates=dates)
    item_ids = {iid for q in qtys.values() for iid, _ in q}
    items = {i.id: i for i in db.scalars(select(Item).where(Item.id.in_(item_ids or [-1]))).all()}
    avg = average_cost_many(db, item_ids, dates=dates, branch_id=branch_id)
    return {d: _valuate(as_of=d, branch_id=branch_id, cost_basis=cost_basis, qtys=qtys[d],
                        items=items, avg=avg[d], excluded=excluded, factors=factors,
                        wh_names={}, with_rows=False)
            for d in dates}
