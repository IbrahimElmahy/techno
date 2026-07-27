"""Cost of goods — the weighted-average purchase cost of an item (030).

Profit is only meaningful if the cost side is pinned to the moment of the sale. This module answers
"what did a unit of this item cost us, as of right now"; `sales_service` calls it once per line and
stores the answer on the line, so later purchases move the average for future sales without
rewriting the margin of past ones.

Kept as a separate, dependency-light module (Library-First) so reports and any future valuation
screen can reuse the same definition of cost instead of re-deriving it differently.
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money
from src.models.purchasing import PurchaseInvoice, PurchaseInvoiceLine, PurchaseReturn, PurchaseReturnLine


def average_cost(db: Session, item_id: int) -> Decimal:
    """Weighted-average cost per BASE unit from everything ever purchased, net of returns.

    Returns ZERO — never None — for an item with no purchases (produced in-house, or opening
    stock). A caller storing this on a document needs a number it can do arithmetic with; a NULL
    would quietly turn every downstream profit into "unknown".
    """
    bought_qty, bought_value = db.execute(
        select(
            func.coalesce(func.sum(PurchaseInvoiceLine.quantity * PurchaseInvoiceLine.unit_factor), 0),
            func.coalesce(func.sum(PurchaseInvoiceLine.line_total), 0),
        ).where(PurchaseInvoiceLine.item_id == item_id)
    ).one()

    # Returned purchases were never really ours — take them back out of both sides so the average
    # reflects what we actually kept and paid for.
    returned_qty, returned_value = db.execute(
        select(
            func.coalesce(func.sum(PurchaseReturnLine.quantity), 0),
            func.coalesce(func.sum(PurchaseReturnLine.quantity * PurchaseInvoiceLine.unit_price), 0),
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
