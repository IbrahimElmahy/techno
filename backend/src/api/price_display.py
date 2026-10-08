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
from src.lib import discounts
from src.models.catalog import Item, PriceTier
from src.models.stock import LocationKind
from src.models.warehouse import Warehouse
from src.services import pricing_service, sales_service, stock_service, tax_service
from src.services.pricing_service import PricingError

router = APIRouter(tags=["price-display"], prefix="/price-display")

ZERO = Decimal("0")


class PriceDisplayOut(BaseModel):
    item_id: int
    code: str
    name: str
    unit: str | None
    unit_price: Decimal
    discount_pct: Decimal
    price_after_discount: Decimal
    vat_pct: Decimal
    price_with_vat: Decimal
    in_stock: bool
    on_hand: Decimal


def _resolve(db: Session, code: str) -> Item:
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

    try:
        base = pricing_service.tier_price(db, item, PriceTier.consumer)
    except PricingError as exc:
        raise HTTPException(
            409, {"code": "no_price", "message": "الصنف ده مالوش سعر مستهلك"}) from exc

    unit_price = to_money(Decimal(str(base)))
    item_pct = Decimal(str(item.default_discount_pct or 0))
    shop_pct = sales_service.fixed_discount_pct(db)
    discount_pct = discounts.combine(item_pct, shop_pct)
    after_discount = discounts.apply(unit_price, item_pct, shop_pct)
    vat_pct = tax_service.vat_rate(db)
    with_vat = to_money(after_discount + tax_service.tax_on(after_discount, vat_pct))

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
