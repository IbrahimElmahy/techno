from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.money import to_money
from src.models.catalog import Item, ItemPrice, PriceTier
from src.models.customer import Customer


class PricingError(Exception):
    pass


def resolve_tier(line_tier: PriceTier | None, customer: Customer | None) -> PriceTier:
    if line_tier is not None:
        return line_tier
    if customer is not None and customer.default_price_tier is not None:
        return customer.default_price_tier
    return PriceTier.consumer


def tier_price(db: Session, item: Item, tier: PriceTier) -> Decimal:
    row = db.scalar(
        select(ItemPrice).where(ItemPrice.item_id == item.id, ItemPrice.tier == tier)
    )
    if row is not None:
        return to_money(row.price)
    if item.sale_price is not None:
        return to_money(item.sale_price)
    raise PricingError(
        "الصنف ده مالوش سعر للشريحة دي ولا سعر بيع أساسي."
    )
