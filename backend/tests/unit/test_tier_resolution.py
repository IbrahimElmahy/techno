"""T007: tier resolution + price fallback (pricing_service) — pure function behaviour."""
from decimal import Decimal

import pytest

from src.models.catalog import PriceTier
from src.services import pricing_service
from src.services.pricing_service import PricingError
from tests.conftest import make_priced_product


def test_resolve_tier_priority(db, world):
    from src.models.customer import Customer

    cust = Customer(code="C1", name="x", customer_type="trader",
                    rep_id=world["rep_a"], territory_id=world["terr_a"],
                    default_price_tier=PriceTier.wholesale)
    # explicit line tier wins
    assert pricing_service.resolve_tier(PriceTier.commercial, cust) == PriceTier.commercial
    # else customer default
    assert pricing_service.resolve_tier(None, cust) == PriceTier.wholesale
    # else consumer
    cust.default_price_tier = None
    assert pricing_service.resolve_tier(None, cust) == PriceTier.consumer
    assert pricing_service.resolve_tier(None, None) == PriceTier.consumer


def test_tier_price_uses_tier_row(db, world):
    item = make_priced_product(db, sale_price="100", tiers={"wholesale": "90", "consumer": "130"})
    assert pricing_service.tier_price(db, item, PriceTier.wholesale) == Decimal("90.00")
    assert pricing_service.tier_price(db, item, PriceTier.consumer) == Decimal("130.00")


def test_tier_price_falls_back_to_base(db, world):
    item = make_priced_product(db, sale_price="100", tiers={"wholesale": "90"})
    # commercial has no row → fall back to base sale_price
    assert pricing_service.tier_price(db, item, PriceTier.commercial) == Decimal("100.00")


def test_tier_price_errors_when_no_price(db, world):
    from src.models.catalog import Item, ItemKind

    it = Item(code="PR-X", name="noprice", kind=ItemKind.product, unit_of_measure="piece",
              sale_price=None)
    db.add(it)
    db.flush()
    with pytest.raises(PricingError):
        pricing_service.tier_price(db, it, PriceTier.consumer)
