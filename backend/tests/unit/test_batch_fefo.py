"""011 FR-005: FEFO consume depletes the earliest-expiry batch first; shortfall raises."""
from datetime import date
from decimal import Decimal

import pytest

from src.models.stock import LocationKind, StockBatch
from src.services import batch_service
from src.services.batch_service import BatchError
from tests.conftest import make_perishable_product


def _batch(db, item, loc, expiry, qty):
    b = StockBatch(item_id=item.id, location_kind=LocationKind.warehouse, location_id=loc,
                   expiry_date=expiry, quantity=Decimal(qty))
    db.add(b)
    db.flush()
    return b


def test_consume_depletes_earliest_expiry_first(db):
    item = make_perishable_product(db)
    _batch(db, item, 1, date(2026, 1, 1), "5")   # earliest
    _batch(db, item, 1, date(2026, 6, 1), "5")   # later
    batch_service.consume_fefo(db, item=item, location_kind=LocationKind.warehouse,
                               location_id=1, quantity=Decimal("7"))
    rows = batch_service.expiring(db, before=date(2027, 1, 1), item_id=item.id)
    remaining = {r.expiry_date: r.quantity for r in rows}
    # earliest fully drained (dropped from >0 list), 2 taken from the later one
    assert date(2026, 1, 1) not in remaining
    assert remaining[date(2026, 6, 1)] == Decimal("3.000")


def test_shortfall_raises(db):
    item = make_perishable_product(db)
    _batch(db, item, 1, date(2026, 1, 1), "2")
    with pytest.raises(BatchError):
        batch_service.consume_fefo(db, item=item, location_kind=LocationKind.warehouse,
                                   location_id=1, quantity=Decimal("3"))


def test_alternate_unit_rejected(db):
    item = make_perishable_product(db)
    with pytest.raises(BatchError):
        batch_service.assert_base_unit(item, Decimal("12"))
    # base unit is fine
    batch_service.assert_base_unit(item, Decimal("1"))
