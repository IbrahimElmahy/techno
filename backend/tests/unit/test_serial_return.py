"""T013: returning a sold-on-this-invoice serial restores it to in_stock."""
from decimal import Decimal

import pytest

from src.models.catalog import ItemSerial, SerialStatus
from src.models.role import RoleName
from src.models.stock import LocationKind
from src.services import serial_service, stock_service
from src.services.sales_service import SaleLine, SalesError, create_sale, return_sale
from tests.conftest import make_customer_with_account, make_serialized_product


def _setup_and_sell(db, inv_world):
    item = make_serialized_product(db)
    cust, _ = make_customer_with_account(db, inv_world["rep_a"], inv_world["terr_a"])
    serial_service.receive(db, item=item, location_kind=LocationKind.warehouse,
                           location_id=inv_world["central_wh"], serials=["SN-1", "SN-2"],
                           actor_user_id=inv_world["admin"])
    db.commit()
    inv = create_sale(
        db, customer_id=cust.id, origin_location_kind=LocationKind.warehouse,
        origin_location_id=inv_world["central_wh"], variable_discount_pct=Decimal("0"),
        cash_amount=Decimal("200"), credit_amount=Decimal("0"),
        lines=[SaleLine(item.id, Decimal("2"), None, None, None, ["SN-1", "SN-2"])],
        actor_role=RoleName.branch_manager, actor_user_id=inv_world["admin"], can_sell_below=True,
    )
    db.commit()
    return item, inv


def test_return_restores_serial(db, inv_world):
    item, inv = _setup_and_sell(db, inv_world)
    return_sale(db, sales_invoice_id=inv.id, lines=[(item.id, Decimal("1"))],
                actor_user_id=inv_world["admin"], serials={item.id: ["SN-1"]})
    db.commit()
    row = db.query(ItemSerial).filter(ItemSerial.item_id == item.id, ItemSerial.serial == "SN-1").one()
    assert row.status == SerialStatus.in_stock and row.location_id == inv_world["central_wh"]
    assert stock_service.on_hand(db, item.id, LocationKind.warehouse, inv_world["central_wh"]) == Decimal("1.000")


def test_return_serial_not_on_invoice_rejected(db, inv_world):
    item, inv = _setup_and_sell(db, inv_world)
    with pytest.raises(SalesError):
        return_sale(db, sales_invoice_id=inv.id, lines=[(item.id, Decimal("1"))],
                    actor_user_id=inv_world["admin"], serials={item.id: ["SN-NOPE"]})


def test_return_count_mismatch_rejected(db, inv_world):
    item, inv = _setup_and_sell(db, inv_world)
    with pytest.raises(SalesError):
        return_sale(db, sales_invoice_id=inv.id, lines=[(item.id, Decimal("2"))],
                    actor_user_id=inv_world["admin"], serials={item.id: ["SN-1"]})  # 1 serial for qty 2
