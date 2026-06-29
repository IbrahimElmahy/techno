"""T008: stock moves in BASE units = entered qty × factor; on-hand/No-Negative in base."""
from decimal import Decimal

import pytest

from src.models.role import RoleName
from src.models.stock import LocationKind, StockDirection
from src.services import sales_service, stock_service
from src.services.sales_service import SaleLine
from src.services.stock_service import StockError
from tests.conftest import make_customer_with_account, make_priced_product, make_unit


def _setup(db, inv_world, on_hand="100"):
    item = make_priced_product(db, sale_price="10")  # base 'piece'
    make_unit(db, item, "carton", 12)
    cust, _ = make_customer_with_account(db, inv_world["rep_a"], inv_world["terr_a"])
    stock_service.post_movement(
        db, item_id=item.id, location_kind=LocationKind.warehouse,
        location_id=inv_world["central_wh"], movement_type="seed_in",
        direction=StockDirection.in_, quantity=Decimal(on_hand), actor_user_id=inv_world["admin"],
        source_doc_type="seed", source_doc_id=0,
    )
    db.commit()
    return item, cust


def _sell(db, inv_world, item, cust, qty, unit):
    line = SaleLine(item.id, Decimal(qty), None, None, unit)
    # price: base 10 × factor; for carton = 120; cash matches net
    factor = 12 if unit == "carton" else 1
    price = Decimal("10") * factor * Decimal(qty)
    return sales_service.create_sale(
        db, customer_id=cust.id, origin_location_kind=LocationKind.warehouse,
        origin_location_id=inv_world["central_wh"], variable_discount_pct=Decimal("0"),
        cash_amount=price, credit_amount=Decimal("0"), lines=[line],
        actor_role=RoleName.branch_manager, actor_user_id=inv_world["admin"], can_sell_below=True,
    )


def test_selling_cartons_moves_base_units(db, inv_world):
    item, cust = _setup(db, inv_world, on_hand="100")
    inv = _sell(db, inv_world, item, cust, "2", "carton")
    line = inv.lines[0]
    assert line.unit == "carton" and Decimal(line.unit_factor) == Decimal("12.000")
    assert Decimal(line.quantity) == Decimal("2")  # entered in cartons
    oh = stock_service.on_hand(db, item.id, LocationKind.warehouse, inv_world["central_wh"])
    assert oh == Decimal("76.000")  # 100 − 2×12


def test_no_unit_is_base(db, inv_world):
    item, cust = _setup(db, inv_world, on_hand="100")
    inv = _sell(db, inv_world, item, cust, "3", None)
    oh = stock_service.on_hand(db, item.id, LocationKind.warehouse, inv_world["central_wh"])
    assert oh == Decimal("97.000")  # base unit, 100 − 3


def test_no_negative_in_base_units(db, inv_world):
    item, cust = _setup(db, inv_world, on_hand="10")  # 10 base = < 1 carton
    with pytest.raises(StockError):  # 1 carton = 12 base > 10 on hand
        _sell(db, inv_world, item, cust, "1", "carton")
