from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money, to_qty
from src.models.catalog import Item
from src.models.stock import LocationKind, StockMovement
from src.models.warehouse import Warehouse
from src.services import costing_service

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
    missing_items: list[dict] = field(default_factory=list)
    negative_rows: int = 0
    negative_value: Decimal = ZERO
    excluded_value: Decimal = ZERO

    def as_dict(self, *, with_rows: bool = True) -> dict:
        out = {
            "as_of": self.as_of.isoformat(), "branch_id": self.branch_id,
            "cost_basis": self.cost_basis, "total": str(self.total),
            "by_category": {k: str(v) for k, v in sorted(
                self.by_category.items(), key=lambda kv: -kv[1])},
            "missing_cost": self.missing_cost, "missing_items": self.missing_items,
            "negative_rows": self.negative_rows, "negative_value": str(self.negative_value),
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
    return quantities_many(db, branch_id=branch_id, dates=[as_of])[as_of]


def quantities_many(db: Session, *, branch_id: int | None,
                    dates: list[date]) -> dict[date, dict[tuple[int, int], Decimal]]:
    when = costing_service.movement_day()
    signed = costing_service.signed_quantity()
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


def _valuate(*, as_of: date, branch_id: int | None, cost_basis: str, qtys, items, costs,
             excluded: set[str], factors: dict[str, Decimal], wh_names: dict,
             with_rows: bool) -> Valuation:
    out = Valuation(as_of=as_of, branch_id=branch_id, cost_basis=cost_basis)
    missing: dict[int, Decimal] = {}
    for (iid, wid), qty in qtys.items():
        item = items.get(iid)
        category = (item.category if item else None) or "بدون فئة"
        if category in excluded:
            unit = costs.get(iid)
            if unit is not None:
                out.excluded_value += to_money(qty * unit)
            continue
        unit, source = None, None
        factor = factors.get(category)
        if cost_basis == "list_factor" and factor is not None and item is not None \
                and item.sale_price is not None and Decimal(str(item.sale_price)) > 0:
            unit, source = Decimal(str(item.sale_price)) * factor / 100, "list_factor"
        if unit is None and iid in costs:
            unit, source = costs[iid], "average"
        if unit is None:
            unit, source = ZERO, "none"
            missing[iid] = missing.get(iid, ZERO) + qty
        value = to_money(qty * unit)
        if qty < 0:
            out.negative_rows += 1
            out.negative_value += value
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
    out.negative_value = to_money(out.negative_value)
    out.missing_cost = len(missing)
    out.missing_items = [
        {"item_id": iid, "item_code": items[iid].code if iid in items else None,
         "item_name": items[iid].name if iid in items else None, "quantity": str(q)}
        for iid, q in sorted(missing.items(), key=lambda kv: (-abs(kv[1]), kv[0]))[:50]]
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
    with_rows: bool = True, book: costing_service.CostBook | None = None,
) -> Valuation:
    cost_basis, excluded, factors = _options(cost_basis, exclude_categories, list_factors)
    qtys = quantities_at(db, branch_id=branch_id, as_of=as_of)
    item_ids = {iid for iid, _ in qtys}
    items = {i.id: i for i in db.scalars(select(Item).where(Item.id.in_(item_ids or [-1]))).all()}
    if book is None:
        book = costing_service.cost_book(db, branch_id=branch_id, until=as_of)
    costs = {iid: c for iid in item_ids if (c := book.at(iid, as_of)) is not None}
    wh_names = dict(db.execute(select(Warehouse.id, Warehouse.name)).all())
    return _valuate(as_of=as_of, branch_id=branch_id, cost_basis=cost_basis, qtys=qtys,
                    items=items, costs=costs, excluded=excluded, factors=factors,
                    wh_names=wh_names, with_rows=with_rows)


def values_at(
    db: Session, *, branch_id: int | None, dates: list[date], cost_basis: str = "average",
    exclude_categories=(), list_factors: dict[str, Decimal | float | str] | None = None,
    book: costing_service.CostBook | None = None,
) -> dict[date, Valuation]:
    dates = sorted(set(dates))
    if not dates:
        return {}
    cost_basis, excluded, factors = _options(cost_basis, exclude_categories, list_factors)
    qtys = quantities_many(db, branch_id=branch_id, dates=dates)
    item_ids = {iid for q in qtys.values() for iid, _ in q}
    items = {i.id: i for i in db.scalars(select(Item).where(Item.id.in_(item_ids or [-1]))).all()}
    if book is None:
        book = costing_service.cost_book(db, branch_id=branch_id, until=max(dates))
    out = {}
    for d in dates:
        costs = {iid: c for iid, _ in qtys[d] if (c := book.at(iid, d)) is not None}
        out[d] = _valuate(as_of=d, branch_id=branch_id, cost_basis=cost_basis, qtys=qtys[d],
                          items=items, costs=costs, excluded=excluded, factors=factors,
                          wh_names={}, with_rows=False)
    return out
