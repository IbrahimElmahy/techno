from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from sqlalchemy import Date, case, cast, func, select
from sqlalchemy.orm import Session, aliased

from src.core.money import ZERO, to_money
from src.lib import discounts
from src.models.manufacturing import ManufacturingOrder, ProductionOrderProduct
from src.models.purchasing import (
    PurchaseInvoice,
    PurchaseInvoiceLine,
    PurchaseReturn,
    PurchaseReturnLine,
)
from src.models.stock import (
    CostingMethod,
    ItemCostReset,
    LocationKind,
    StockDirection,
    StockMovement,
    StockSetting,
)
from src.models.stock_permit import PermitKind, StockPermit, StockPermitLine

OPENING_DOC = "a5_opening"
OPENING_DOCS = ("a5_opening", "a5_opening_fix")
_PLACES = Decimal("0.000001")


def movement_day():
    return func.coalesce(StockMovement.movement_date, cast(StockMovement.created_at, Date))


def signed_quantity():
    return case((StockMovement.direction == StockDirection.in_, StockMovement.quantity),
                else_=-StockMovement.quantity)


@dataclass
class CostBook:
    days: dict[int, list[date]] = field(default_factory=dict)
    costs: dict[int, list[Decimal]] = field(default_factory=dict)

    def at(self, item_id: int, day: date) -> Decimal | None:
        days = self.days.get(item_id)
        if not days:
            return None
        k = bisect_right(days, day) - 1
        return self.costs[item_id][k] if k >= 0 else None

    def latest(self, item_id: int) -> Decimal | None:
        costs = self.costs.get(item_id)
        return costs[-1] if costs else None

    def on(self, day: date) -> dict[int, Decimal]:
        out = {}
        for item_id in self.days:
            c = self.at(item_id, day)
            if c is not None:
                out[item_id] = c
        return out


def _items_filter(column, item_ids, branch_items):
    conds = []
    if item_ids is not None:
        conds.append(column.in_(list(item_ids) or [-1]))
    if branch_items is not None:
        conds.append(column.in_(branch_items))
    return conds


def _branch_items(branch_id: int | None):
    if branch_id is None:
        return None
    inner = aliased(StockMovement)
    return select(inner.item_id).where(inner.branch_id == branch_id).distinct()


def _run(db: Session, stmt, day_col, until: date | None):
    if until is not None:
        stmt = stmt.where(day_col <= until)
    return [(i, d, Decimal(str(q or 0)), Decimal(str(v or 0)))
            for i, d, q, v in db.execute(stmt).all() if d is not None]


def _purchases(db: Session, ids, branch_items, until):
    day = func.coalesce(PurchaseInvoice.purchase_date, cast(PurchaseInvoice.created_at, Date))
    after = 1 - func.coalesce(PurchaseInvoice.combined_pct, 0) / 100
    return _run(db, select(
        PurchaseInvoiceLine.item_id, day,
        func.sum(PurchaseInvoiceLine.quantity * PurchaseInvoiceLine.unit_factor),
        func.sum(PurchaseInvoiceLine.line_total * after))
        .join(PurchaseInvoice, PurchaseInvoice.id == PurchaseInvoiceLine.invoice_id)
        .where(*_items_filter(PurchaseInvoiceLine.item_id, ids, branch_items))
        .group_by(PurchaseInvoiceLine.item_id, day), day, until)


def _purchase_returns(db: Session, ids, branch_items, until):
    day = func.coalesce(PurchaseReturn.return_date, cast(PurchaseReturn.created_at, Date))
    ratio = case((PurchaseReturn.gross > 0, PurchaseReturn.value / PurchaseReturn.gross), else_=1)
    return _run(db, select(
        PurchaseReturnLine.item_id, day,
        -func.sum(PurchaseReturnLine.quantity * PurchaseReturnLine.unit_factor),
        -func.sum(PurchaseReturnLine.line_total * ratio))
        .join(PurchaseReturn, PurchaseReturn.id == PurchaseReturnLine.return_id)
        .where(PurchaseReturn.reversed_at.is_(None),
               *_items_filter(PurchaseReturnLine.item_id, ids, branch_items))
        .group_by(PurchaseReturnLine.item_id, day), day, until)


def _openings(db: Session, ids, branch_items, until):
    day = movement_day()
    return _run(db, select(
        StockMovement.item_id, day, func.sum(StockMovement.quantity),
        func.sum(StockMovement.quantity * StockMovement.unit_cost))
        .where(StockMovement.source_doc_type == OPENING_DOC,
               StockMovement.direction == StockDirection.in_,
               StockMovement.location_kind == LocationKind.warehouse,
               StockMovement.unit_cost.is_not(None),
               *_items_filter(StockMovement.item_id, ids, branch_items))
        .group_by(StockMovement.item_id, day), day, until)


def _production(db: Session, ids, branch_items, until):
    day, sq = movement_day(), signed_quantity()
    per_unit = ProductionOrderProduct.total_cost / (
        ProductionOrderProduct.quantity * func.coalesce(ProductionOrderProduct.unit_factor, 1))
    return _run(db, select(StockMovement.item_id, day, func.sum(sq), func.sum(sq * per_unit))
                .select_from(ProductionOrderProduct)
                .join(StockMovement, StockMovement.id == ProductionOrderProduct.stock_movement_id)
                .where(ProductionOrderProduct.total_cost > 0, ProductionOrderProduct.quantity > 0,
                       *_items_filter(StockMovement.item_id, ids, branch_items))
                .group_by(StockMovement.item_id, day), day, until)


def _manufacturing(db: Session, ids, branch_items, until):
    day, sq = movement_day(), signed_quantity()
    per_unit = ManufacturingOrder.total_cost / ManufacturingOrder.quantity
    return _run(db, select(StockMovement.item_id, day, func.sum(sq), func.sum(sq * per_unit))
                .select_from(ManufacturingOrder)
                .join(StockMovement, StockMovement.id == ManufacturingOrder.stock_movement_id)
                .where(ManufacturingOrder.total_cost > 0, ManufacturingOrder.quantity > 0,
                       *_items_filter(StockMovement.item_id, ids, branch_items))
                .group_by(StockMovement.item_id, day), day, until)


def _permit_openings(db: Session, ids, branch_items, until):
    day, sq = movement_day(), signed_quantity()
    return _run(db, select(StockMovement.item_id, day, func.sum(sq),
                           func.sum(sq * StockPermitLine.unit_cost))
                .select_from(StockPermitLine)
                .join(StockPermit, StockPermit.id == StockPermitLine.permit_id)
                .join(StockMovement, StockMovement.id == StockPermitLine.stock_movement_id)
                .where(StockPermit.kind == PermitKind.opening, StockPermitLine.unit_cost > 0,
                       *_items_filter(StockMovement.item_id, ids, branch_items))
                .group_by(StockMovement.item_id, day), day, until)


ACQUISITION_KINDS = ("purchase", "purchase_return", "opening", "permit_opening", "production",
                     "manufacturing")


def acquisitions(db: Session, *, item_ids=None, branch_id: int | None = None,
                 until: date | None = None) -> dict[str, list[tuple[int, date, Decimal, Decimal]]]:
    branch_items = _branch_items(branch_id)
    sources = {"purchase": _purchases, "purchase_return": _purchase_returns,
               "opening": _openings, "permit_opening": _permit_openings,
               "production": _production,
               "manufacturing": _manufacturing}
    return {kind: sources[kind](db, item_ids, branch_items, until) for kind in ACQUISITION_KINDS}


def cost_book(db: Session, *, item_ids=None, branch_id: int | None = None,
              until: date | None = None) -> CostBook:
    if item_ids is not None and not item_ids:
        return CostBook()
    branch_items = _branch_items(branch_id)
    day = movement_day()
    stmt = (select(StockMovement.item_id, day, func.sum(signed_quantity()))
            .where(StockMovement.location_kind == LocationKind.warehouse,
                   *_items_filter(StockMovement.item_id, item_ids, branch_items))
            .group_by(StockMovement.item_id, day))
    if until is not None:
        stmt = stmt.where(day <= until)
    moves: dict[int, dict[date, Decimal]] = {}
    for item_id, d, q in db.execute(stmt).all():
        if d is not None:
            moves.setdefault(item_id, {})[d] = Decimal(str(q or 0))

    acq: dict[int, dict[date, list[Decimal]]] = {}
    for rows in acquisitions(db, item_ids=item_ids, branch_id=branch_id, until=until).values():
        for item_id, d, q, v in rows:
            slot = acq.setdefault(item_id, {}).setdefault(d, [Decimal(0), Decimal(0)])
            slot[0] += q
            slot[1] += v

    resets: dict[int, dict[date, Decimal]] = {}
    reset_stmt = (select(ItemCostReset.item_id, ItemCostReset.effective_date,
                         ItemCostReset.unit_cost)
                  .where(*_items_filter(ItemCostReset.item_id, item_ids, branch_items))
                  .order_by(ItemCostReset.id))
    if until is not None:
        reset_stmt = reset_stmt.where(ItemCostReset.effective_date <= until)
    for item_id, d, c in db.execute(reset_stmt).all():
        resets.setdefault(item_id, {})[d] = Decimal(str(c))

    book = CostBook()
    for item_id in set(moves) | set(acq) | set(resets):
        m, a, r = moves.get(item_id, {}), acq.get(item_id, {}), resets.get(item_id, {})
        on_hand, avg = Decimal(0), None
        days: list[date] = []
        costs: list[Decimal] = []
        for d in sorted(set(m) | set(a) | set(r)):
            if d in r:
                new = r[d].quantize(_PLACES)
                if new != avg:
                    days.append(d)
                    costs.append(new)
                avg = new
            got = a.get(d)
            if got is not None:
                q, v = got
                base = on_hand if on_hand > 0 else Decimal(0)
                new = avg
                if avg is None or base == 0:
                    if q > 0:
                        new = v / q
                elif base + q > 0:
                    new = (base * avg + v) / (base + q)
                if new is not None and new < 0:
                    new = avg
                if new is not None:
                    new = new.quantize(_PLACES)
                    if new != avg:
                        days.append(d)
                        costs.append(new)
                    avg = new
            on_hand += m.get(d, Decimal(0))
        if days:
            book.days[item_id] = days
            book.costs[item_id] = costs
    return book


def known_costs(db: Session, item_ids, *, as_of: date | None = None) -> dict[int, Decimal]:
    ids = list({int(i) for i in item_ids})
    if not ids:
        return {}
    book = cost_book(db, item_ids=ids if len(ids) <= 500 else None)
    out = {}
    for i in ids:
        c = book.at(i, as_of) if as_of is not None else book.latest(i)
        if c is not None:
            out[i] = c
    return out


def known_cost(db: Session, item_id: int, *, as_of: date | None = None) -> Decimal | None:
    return known_costs(db, [item_id], as_of=as_of).get(int(item_id))


def average_cost(db: Session, item_id: int) -> Decimal:
    return to_money(known_cost(db, item_id) or ZERO)


def average_cost_bulk(db: Session, item_ids) -> dict[int, Decimal]:
    ids = list({int(i) for i in item_ids})
    known = known_costs(db, ids)
    return {i: to_money(known.get(i, ZERO)) for i in ids}


def last_purchase_cost(db: Session, item_id: int, supplier_id: int | None = None) -> Decimal:
    stmt = (select(PurchaseInvoiceLine.unit_price, PurchaseInvoiceLine.unit_factor,
                   PurchaseInvoiceLine.discount_pct, PurchaseInvoice.combined_pct)
            .join(PurchaseInvoice, PurchaseInvoice.id == PurchaseInvoiceLine.invoice_id)
            .where(PurchaseInvoiceLine.item_id == item_id))
    if supplier_id is not None:
        stmt = stmt.where(PurchaseInvoice.supplier_id == supplier_id)
    row = db.execute(stmt.order_by(PurchaseInvoice.id.desc(), PurchaseInvoiceLine.id.desc())
                     .limit(1)).first()
    if row is None or row[0] is None:
        return ZERO
    unit_price = discounts.apply(Decimal(str(row[0])), row[2], row[3])
    factor = Decimal(str(row[1] or 1))
    return to_money(unit_price / factor) if factor else to_money(unit_price)


def costing_method(db: Session) -> CostingMethod:
    setting = db.scalar(select(StockSetting).limit(1))
    return setting.costing_method if setting else CostingMethod.average


def unit_cost(db: Session, item_id: int) -> Decimal:
    if costing_method(db) == CostingMethod.last_purchase:
        return last_purchase_cost(db, item_id)
    return average_cost(db, item_id)


def last_purchase_cost_bulk(db: Session, item_ids) -> dict[int, Decimal]:
    ids = list({int(i) for i in item_ids})
    if not ids:
        return {}
    rows = db.execute(
        select(PurchaseInvoiceLine.item_id, PurchaseInvoiceLine.unit_price,
               PurchaseInvoiceLine.unit_factor, PurchaseInvoiceLine.discount_pct,
               PurchaseInvoice.combined_pct, PurchaseInvoice.id, PurchaseInvoiceLine.id)
        .join(PurchaseInvoice, PurchaseInvoice.id == PurchaseInvoiceLine.invoice_id)
        .where(PurchaseInvoiceLine.item_id.in_(ids))
        .order_by(PurchaseInvoice.id.asc(), PurchaseInvoiceLine.id.asc())
    ).all()
    out: dict[int, Decimal] = {i: ZERO for i in ids}
    for item_id, price, factor, line_pct, doc_pct, _inv, _line in rows:
        if price is None:
            continue
        unit_price = discounts.apply(Decimal(str(price)), line_pct, doc_pct)
        f = Decimal(str(factor or 1))
        out[item_id] = to_money(unit_price / f) if f else to_money(unit_price)
    return out


def unit_cost_bulk(db: Session, item_ids) -> dict[int, Decimal]:
    if costing_method(db) == CostingMethod.last_purchase:
        return last_purchase_cost_bulk(db, item_ids)
    return average_cost_bulk(db, item_ids)
