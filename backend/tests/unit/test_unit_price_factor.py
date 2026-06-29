"""T013: a tiered line's default price = base-tier price × factor; below base×factor needs capability."""
from decimal import Decimal

import pytest

from src.models.catalog import PriceTier
from src.models.role import RoleName
from src.models.stock import LocationKind, StockDirection
from src.services import sales_service, stock_service
from src.services.sales_service import SaleLine, SalesError
from tests.conftest import make_customer_with_account, make_priced_product, make_unit


def _setup(db, inv_world):
    item = make_priced_product(db, sale_price="100", tiers={"wholesale": "90"})
    make_unit(db, item, "carton", 12)
    cust, _ = make_customer_with_account(db, inv_world["rep_a"], inv_world["terr_a"])
    cust.default_price_tier = PriceTier.wholesale
    db.flush()
    stock_service.post_movement(
        db, item_id=item.id, location_kind=LocationKind.warehouse,
        location_id=inv_world["central_wh"], movement_type="seed_in",
        direction=StockDirection.in_, quantity=Decimal("100"), actor_user_id=inv_world["admin"],
        source_doc_type="seed", source_doc_id=0,
    )
    db.commit()
    return item, cust


def _sell(db, inv_world, item, cust, *, unit, unit_price, can_sell_below):
    price = Decimal(unit_price)
    return sales_service.create_sale(
        db, customer_id=cust.id, origin_location_kind=LocationKind.warehouse,
        origin_location_id=inv_world["central_wh"], variable_discount_pct=Decimal("0"),
        cash_amount=price, credit_amount=Decimal("0"),
        lines=[SaleLine(item.id, Decimal("1"), None, price, unit)],
        actor_role=RoleName.branch_manager, actor_user_id=inv_world["admin"],
        can_sell_below=can_sell_below,
    )


def test_default_price_is_base_tier_times_factor(db, inv_world):
    item, cust = _setup(db, inv_world)
    # no explicit price → wholesale 90 × 12 = 1080 per carton
    inv = sales_service.create_sale(
        db, customer_id=cust.id, origin_location_kind=LocationKind.warehouse,
        origin_location_id=inv_world["central_wh"], variable_discount_pct=Decimal("0"),
        cash_amount=Decimal("1080"), credit_amount=Decimal("0"),
        lines=[SaleLine(item.id, Decimal("1"), None, None, "carton")],
        actor_role=RoleName.branch_manager, actor_user_id=inv_world["admin"],
    )
    assert Decimal(inv.lines[0].unit_price) == Decimal("1080.00")


def test_below_base_times_factor_needs_capability(db, inv_world):
    item, cust = _setup(db, inv_world)
    # 1000 < 1080 (wholesale×12) → rejected without capability
    with pytest.raises(SalesError):
        _sell(db, inv_world, item, cust, unit="carton", unit_price="1000", can_sell_below=False)
    # allowed with capability
    inv = _sell(db, inv_world, item, cust, unit="carton", unit_price="1000", can_sell_below=True)
    assert Decimal(inv.lines[0].unit_price) == Decimal("1000.00")
