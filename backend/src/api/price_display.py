"""شاشة معلومات المنتج — the customer-facing price screen — 031-a5-restructure.

A screen at the counter facing the customer: enter an item code, the item's name and price appear
in type readable from the other side of a desk. Their `/price-display-screen`.

Theirs scans a barcode. Ours takes the item code, because the client asked for barcodes to be out
of this system entirely — a deliberate divergence from a5, not a gap. A scanner that emits the item
code as text still works: to this screen it is a keyboard.

**The number shown must be the number that gets billed.** A price display that disagrees with the
invoice is worse than no display: the customer has already read a figure and now has to be argued
out of it. So the price is built by the same steps `sales_service` uses for a line — consumer tier
price × unit factor, less the item's default discount, plus the company's VAT rate — rather than by
a shortcut that happens to agree today.

Read-only, and deliberately thin. It resolves a code and answers; anything the counter needs to DO
belongs on the invoice screen behind it.
"""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_CATALOG_READ
from src.core.db import get_db
from src.core.money import to_money, to_qty
from src.models.catalog import Item, PriceTier
from src.models.stock import LocationKind
from src.models.warehouse import Warehouse
from src.services import pricing_service, stock_service, tax_service
from src.services.pricing_service import PricingError

router = APIRouter(tags=["price-display"], prefix="/price-display")

ZERO = Decimal("0")


class PriceDisplayOut(BaseModel):
    item_id: int
    code: str
    name: str
    unit: str | None
    # Every step, not just the total: a customer asking «why that much?» is answered at the counter
    # instead of by opening the invoice screen.
    unit_price: Decimal
    discount_pct: Decimal
    price_after_discount: Decimal
    vat_pct: Decimal
    price_with_vat: Decimal
    # «Do you have it?» is the second question every time, so it is answered without a second scan.
    in_stock: bool
    on_hand: Decimal


def _resolve(db: Session, code: str) -> Item:
    """The item, by its code, exactly.

    Exact rather than partial: a counter display that guesses which item was meant will eventually
    quote the wrong price to somebody standing in front of it, and a price read aloud is hard to
    take back.
    """
    item = db.scalar(select(Item).where(Item.code == code))
    if item is None:
        raise HTTPException(404, {"code": "not_found", "message": "الكود ده مش معروف"})
    return item


@router.get("/lookup", response_model=PriceDisplayOut)
def lookup(
    code: str = Query(..., min_length=1, description="the item code"),
    _: CurrentUser = Depends(require_capability(CAP_CATALOG_READ)),
    db: Session = Depends(get_db),
) -> PriceDisplayOut:
    item = _resolve(db, code.strip())
    if not item.active:
        raise HTTPException(404, {"code": "not_found", "message": "الصنف ده موقوف"})

    # المستهلك — the walk-in price. A customer standing at the counter is not on a trade tier, and
    # showing them a wholesale figure would be a promise the invoice will not keep.
    try:
        base = pricing_service.tier_price(db, item, PriceTier.consumer)
    except PricingError as exc:
        raise HTTPException(
            409, {"code": "no_price", "message": "الصنف ده مالوش سعر مستهلك"}) from exc

    # The base unit: with no barcode there is no way to say «this is the carton», and a
    # counter display quoting a carton price for a piece is the same error as quoting the wrong
    # item. The invoice is where an alternate unit gets chosen.
    unit_price = to_money(Decimal(str(base)))
    discount_pct = Decimal(str(item.default_discount_pct or 0))
    after_discount = to_money(unit_price * (Decimal("1") - discount_pct / Decimal("100")))
    vat_pct = tax_service.vat_rate(db)
    with_vat = to_money(after_discount + tax_service.tax_on(after_discount, vat_pct))

    # Across every warehouse: the customer is asking whether the company has it, not whether this
    # particular room does.
    on_hand = ZERO
    for wh in db.scalars(select(Warehouse).where(Warehouse.active.is_(True))).all():
        on_hand += Decimal(str(stock_service.on_hand(
            db, item.id, LocationKind.warehouse, wh.id)))
    on_hand = to_qty(on_hand)

    return PriceDisplayOut(
        item_id=item.id, code=item.code, name=item.name,
        unit=item.unit_of_measure,
        unit_price=unit_price, discount_pct=discount_pct,
        price_after_discount=after_discount, vat_pct=vat_pct, price_with_vat=with_vat,
        in_stock=on_hand > to_qty(0), on_hand=on_hand,
    )
