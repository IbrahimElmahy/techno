"""Pricing service (007, T008).

Resolves a sale line's price tier and the price for that tier. Deterministic and pure:
- resolve_tier: line tier → customer default → consumer.
- tier_price: the item_price row for (item, tier) → fallback to item.sale_price → error if neither.

Keeps the base item.sale_price as the fallback so 002 items (single price) keep pricing (research R3).
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.money import to_money
from src.models.catalog import Item, ItemPrice, PriceTier
from src.models.customer import Customer


class PricingError(Exception):
    """No price available for an item (no tier row and no base sale_price)."""


def resolve_tier(line_tier: PriceTier | None, customer: Customer | None) -> PriceTier:
    """Explicit line tier wins; else the customer's default; else the consumer tier."""
    if line_tier is not None:
        return line_tier
    if customer is not None and customer.default_price_tier is not None:
        return customer.default_price_tier
    return PriceTier.consumer


def tier_price(db: Session, item: Item, tier: PriceTier) -> Decimal:
    """Price for (item, tier): the item_price row if present, else the base sale_price; else error."""
    row = db.scalar(
        select(ItemPrice).where(ItemPrice.item_id == item.id, ItemPrice.tier == tier)
    )
    if row is not None:
        return to_money(row.price)
    if item.sale_price is not None:
        return to_money(item.sale_price)
    raise PricingError(
        f"Item {item.id} has no price for tier '{tier.value}' and no base sale price."
    )
