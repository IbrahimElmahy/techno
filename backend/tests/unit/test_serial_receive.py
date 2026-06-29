"""T005: receiving serials registers them in_stock and raises on-hand by N."""
from decimal import Decimal

import pytest

from src.models.catalog import SerialStatus
from src.models.stock import LocationKind
from src.services import serial_service, stock_service
from src.services.serial_service import SerialError
from tests.conftest import make_priced_product, make_serialized_product


def _wh(inv_world):
    return LocationKind.warehouse, inv_world["central_wh"]


def test_receive_registers_and_raises_onhand(db, inv_world):
    item = make_serialized_product(db)
    kind, loc = _wh(inv_world)
    rows = serial_service.receive(db, item=item, location_kind=kind, location_id=loc,
                                  serials=["SN-1", "SN-2"], actor_user_id=inv_world["admin"])
    db.commit()
    assert len(rows) == 2
    assert all(r.status == SerialStatus.in_stock for r in rows)
    assert stock_service.on_hand(db, item.id, kind, loc) == Decimal("2.000")


def test_duplicate_serial_rejected(db, inv_world):
    item = make_serialized_product(db)
    kind, loc = _wh(inv_world)
    serial_service.receive(db, item=item, location_kind=kind, location_id=loc,
                           serials=["SN-1"], actor_user_id=inv_world["admin"])
    with pytest.raises(SerialError):
        serial_service.receive(db, item=item, location_kind=kind, location_id=loc,
                               serials=["SN-1"], actor_user_id=inv_world["admin"])


def test_non_serialized_rejected(db, inv_world):
    item = make_priced_product(db)  # not serialized
    kind, loc = _wh(inv_world)
    with pytest.raises(SerialError):
        serial_service.receive(db, item=item, location_kind=kind, location_id=loc,
                               serials=["SN-1"], actor_user_id=inv_world["admin"])
