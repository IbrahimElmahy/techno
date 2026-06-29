"""T009: serialized sale guards — count==qty, base unit, in_stock@origin; serials↔serialized."""
from decimal import Decimal

import pytest

from src.models.catalog import ItemSerial, SerialStatus
from src.models.role import RoleName
from src.models.stock import LocationKind, StockDirection
from src.services import serial_service, stock_service
from src.services.sales_service import SaleLine, SalesError, create_sale
from tests.conftest import (
    make_customer_with_account,
    make_priced_product,
    make_serialized_product,
    make_unit,
)


def _setup(db, inv_world, serials=("SN-1", "SN-2", "SN-3")):
    item = make_serialized_product(db)
    cust, _ = make_customer_with_account(db, inv_world["rep_a"], inv_world["terr_a"])
    serial_service.receive(db, item=item, location_kind=LocationKind.warehouse,
                           location_id=inv_world["central_wh"], serials=list(serials),
                           actor_user_id=inv_world["admin"])
    db.commit()
    return item, cust


def _sell(db, inv_world, item, cust, qty, serials, unit=None):
    return create_sale(
        db, customer_id=cust.id, origin_location_kind=LocationKind.warehouse,
        origin_location_id=inv_world["central_wh"], variable_discount_pct=Decimal("0"),
        cash_amount=Decimal("100") * Decimal(qty), credit_amount=Decimal("0"),
        lines=[SaleLine(item.id, Decimal(qty), None, None, unit, serials)],
        actor_role=RoleName.branch_manager, actor_user_id=inv_world["admin"], can_sell_below=True,
    )


def test_sell_marks_serials_sold_and_drops_onhand(db, inv_world):
    item, cust = _setup(db, inv_world)
    _sell(db, inv_world, item, cust, "2", ["SN-1", "SN-2"])
    db.commit()
    assert stock_service.on_hand(db, item.id, LocationKind.warehouse, inv_world["central_wh"]) == Decimal("1.000")
    statuses = {r.serial: r.status for r in db.query(ItemSerial).filter(ItemSerial.item_id == item.id)}
    assert statuses["SN-1"] == SerialStatus.sold and statuses["SN-3"] == SerialStatus.in_stock


def test_count_must_equal_quantity(db, inv_world):
    item, cust = _setup(db, inv_world)
    with pytest.raises(SalesError):
        _sell(db, inv_world, item, cust, "2", ["SN-1"])  # 1 serial for qty 2


def test_serial_not_at_origin_rejected(db, inv_world):
    item, cust = _setup(db, inv_world)
    with pytest.raises(SalesError):
        _sell(db, inv_world, item, cust, "1", ["SN-UNKNOWN"])


def test_serialized_without_serials_rejected(db, inv_world):
    item, cust = _setup(db, inv_world)
    with pytest.raises(SalesError):
        _sell(db, inv_world, item, cust, "1", None)


def test_non_serialized_with_serials_rejected(db, inv_world):
    item = make_priced_product(db)
    cust, _ = make_customer_with_account(db, inv_world["rep_a"], inv_world["terr_a"], code="C2")
    stock_service.post_movement(
        db, item_id=item.id, location_kind=LocationKind.warehouse, location_id=inv_world["central_wh"],
        movement_type="seed", direction=StockDirection.in_, quantity=Decimal("5"),
        actor_user_id=inv_world["admin"], source_doc_type="seed", source_doc_id=0)
    db.commit()
    with pytest.raises(SalesError):
        _sell(db, inv_world, item, cust, "1", ["SN-X"])


def test_alternate_unit_rejected(db, inv_world):
    item, cust = _setup(db, inv_world)
    make_unit(db, item, "carton", 12)
    db.commit()
    with pytest.raises(SalesError):
        _sell(db, inv_world, item, cust, "1", ["SN-1"], unit="carton")
