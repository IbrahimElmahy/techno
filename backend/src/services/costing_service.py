from __future__ import annotations

from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money
from src.lib import discounts
from src.models.purchasing import PurchaseInvoice, PurchaseInvoiceLine, PurchaseReturn, PurchaseReturnLine
from src.models.stock import CostingMethod, StockSetting


def _after_doc_discount(column):
    return column * (1 - func.coalesce(PurchaseInvoice.combined_pct, 0) / 100)


def average_cost(db: Session, item_id: int) -> Decimal:
    bought_qty, bought_value = db.execute(
        select(
            func.coalesce(func.sum(PurchaseInvoiceLine.quantity * PurchaseInvoiceLine.unit_factor), 0),
            func.coalesce(func.sum(_after_doc_discount(PurchaseInvoiceLine.line_total)), 0),
        )
        .join(PurchaseInvoice, PurchaseInvoice.id == PurchaseInvoiceLine.invoice_id)
        .where(PurchaseInvoiceLine.item_id == item_id)
    ).one()

    returned_qty, returned_value = db.execute(
        select(
            func.coalesce(func.sum(PurchaseReturnLine.quantity), 0),
            func.coalesce(func.sum(_after_doc_discount(
                PurchaseReturnLine.quantity * PurchaseInvoiceLine.unit_price
                * (1 - func.coalesce(PurchaseInvoiceLine.discount_pct, 0) / 100))), 0),
        )
        .select_from(PurchaseReturnLine)
        .join(PurchaseReturn, PurchaseReturn.id == PurchaseReturnLine.return_id)
        .join(PurchaseInvoice, PurchaseInvoice.id == PurchaseReturn.purchase_invoice_id)
        .join(
            PurchaseInvoiceLine,
            (PurchaseInvoiceLine.invoice_id == PurchaseInvoice.id)
            & (PurchaseInvoiceLine.item_id == PurchaseReturnLine.item_id),
        )
        .where(PurchaseReturnLine.item_id == item_id)
    ).one()

    net_qty = Decimal(str(bought_qty or 0)) - Decimal(str(returned_qty or 0))
    net_value = Decimal(str(bought_value or 0)) - Decimal(str(returned_value or 0))
    if net_qty <= 0:
        return ZERO
    return to_money(net_value / net_qty)


def last_purchase_cost(db: Session, item_id: int) -> Decimal:
    row = db.execute(
        select(PurchaseInvoiceLine.unit_price, PurchaseInvoiceLine.unit_factor,
               PurchaseInvoiceLine.discount_pct, PurchaseInvoice.combined_pct)
        .join(PurchaseInvoice, PurchaseInvoice.id == PurchaseInvoiceLine.invoice_id)
        .where(PurchaseInvoiceLine.item_id == item_id)
        .order_by(PurchaseInvoice.id.desc(), PurchaseInvoiceLine.id.desc())
        .limit(1)
    ).first()
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


def average_cost_bulk(db: Session, item_ids) -> dict[int, Decimal]:
    ids = list({int(i) for i in item_ids})
    if not ids:
        return {}

    bought: dict[int, tuple[Decimal, Decimal]] = {}
    for item_id, qty, value in db.execute(
        select(
            PurchaseInvoiceLine.item_id,
            func.coalesce(func.sum(
                PurchaseInvoiceLine.quantity * PurchaseInvoiceLine.unit_factor), 0),
            func.coalesce(func.sum(_after_doc_discount(PurchaseInvoiceLine.line_total)), 0),
        )
        .join(PurchaseInvoice, PurchaseInvoice.id == PurchaseInvoiceLine.invoice_id)
        .where(PurchaseInvoiceLine.item_id.in_(ids))
        .group_by(PurchaseInvoiceLine.item_id)
    ).all():
        bought[item_id] = (Decimal(str(qty or 0)), Decimal(str(value or 0)))

    returned: dict[int, tuple[Decimal, Decimal]] = {}
    for item_id, qty, value in db.execute(
        select(
            PurchaseReturnLine.item_id,
            func.coalesce(func.sum(PurchaseReturnLine.quantity), 0),
            func.coalesce(func.sum(_after_doc_discount(
                PurchaseReturnLine.quantity * PurchaseInvoiceLine.unit_price
                * (1 - func.coalesce(PurchaseInvoiceLine.discount_pct, 0) / 100))), 0),
        )
        .select_from(PurchaseReturnLine)
        .join(PurchaseReturn, PurchaseReturn.id == PurchaseReturnLine.return_id)
        .join(PurchaseInvoice, PurchaseInvoice.id == PurchaseReturn.purchase_invoice_id)
        .join(
            PurchaseInvoiceLine,
            (PurchaseInvoiceLine.invoice_id == PurchaseInvoice.id)
            & (PurchaseInvoiceLine.item_id == PurchaseReturnLine.item_id),
        )
        .where(PurchaseReturnLine.item_id.in_(ids))
        .group_by(PurchaseReturnLine.item_id)
    ).all():
        returned[item_id] = (Decimal(str(qty or 0)), Decimal(str(value or 0)))

    out: dict[int, Decimal] = {}
    for item_id in ids:
        b_qty, b_val = bought.get(item_id, (ZERO, ZERO))
        r_qty, r_val = returned.get(item_id, (ZERO, ZERO))
        net_qty = b_qty - r_qty
        net_val = b_val - r_val
        out[item_id] = to_money(net_val / net_qty) if net_qty > 0 else ZERO
    return out


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
