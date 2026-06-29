"""T013: below-tier price needs the capability; at/above always allowed; line records tier+price."""
from decimal import Decimal

import pytest

from src.models.catalog import PriceTier
from src.models.role import RoleName
from src.models.stock import LocationKind, StockDirection
from src.services import sales_service, stock_service
from src.services.sales_service import SaleLine, SalesError
from tests.conftest import make_customer_with_account, make_priced_product


def _setup(db, inv_world, *, default_tier=PriceTier.wholesale):
    item = make_priced_product(db, sale_price="100", tiers={"wholesale": "90", "consumer": "130"})
    cust, _acc = make_customer_with_account(db, inv_world["rep_a"], inv_world["terr_a"])
    cust.default_price_tier = default_tier
    db.flush()
    stock_service.post_movement(
        db, item_id=item.id, location_kind=LocationKind.warehouse,
        location_id=inv_world["central_wh"], movement_type="seed_in",
        direction=StockDirection.in_, quantity=Decimal("100"), actor_user_id=inv_world["admin"],
        source_doc_type="seed", source_doc_id=0,
    )
    db.commit()
    return item, cust


def _sell(db, inv_world, item, cust, *, unit_price, can_sell_below):
    price = Decimal(unit_price)
    return sales_service.create_sale(
        db, customer_id=cust.id, origin_location_kind=LocationKind.warehouse,
        origin_location_id=inv_world["central_wh"], variable_discount_pct=Decimal("0"),
        cash_amount=price, credit_amount=Decimal("0"),
        lines=[SaleLine(item.id, Decimal("1"), None, price)],
        actor_role=RoleName.branch_manager, actor_user_id=inv_world["admin"],
        can_sell_below=can_sell_below,
    )


def test_below_tier_rejected_without_capability(db, inv_world):
    item, cust = _setup(db, inv_world)  # wholesale = 90
    with pytest.raises(SalesError):
        _sell(db, inv_world, item, cust, unit_price="80", can_sell_below=False)


def test_below_tier_allowed_with_capability(db, inv_world):
    item, cust = _setup(db, inv_world)
    inv = _sell(db, inv_world, item, cust, unit_price="80", can_sell_below=True)
    line = inv.lines[0]
    assert Decimal(line.unit_price) == Decimal("80.00")
    assert line.price_tier == PriceTier.wholesale  # resolved tier recorded


def test_at_tier_allowed_for_anyone(db, inv_world):
    item, cust = _setup(db, inv_world)
    inv = _sell(db, inv_world, item, cust, unit_price="90", can_sell_below=False)
    assert Decimal(inv.lines[0].unit_price) == Decimal("90.00")


def test_above_tier_allowed_for_anyone(db, inv_world):
    item, cust = _setup(db, inv_world)
    inv = _sell(db, inv_world, item, cust, unit_price="120", can_sell_below=False)
    assert Decimal(inv.lines[0].unit_price) == Decimal("120.00")
