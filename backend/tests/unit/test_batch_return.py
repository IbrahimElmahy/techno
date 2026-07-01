"""011 FR-006: a perishable return restores quantity to a batch at the given expiry; missing → error."""
from datetime import date
from decimal import Decimal

import pytest

from src.models.stock import LocationKind
from src.services import batch_service
from src.services.batch_service import BatchError
from tests.conftest import make_perishable_product


def test_restore_upserts_at_expiry(db):
    item = make_perishable_product(db)
    batch_service.restore_for_return(db, item=item, location_kind=LocationKind.warehouse,
                                     location_id=1, expiry_date=date(2026, 5, 1),
                                     quantity=Decimal("4"))
    batch_service.restore_for_return(db, item=item, location_kind=LocationKind.warehouse,
                                     location_id=1, expiry_date=date(2026, 5, 1),
                                     quantity=Decimal("2"))
    rows = batch_service.expiring(db, before=date(2027, 1, 1), item_id=item.id)
    assert len(rows) == 1
    assert rows[0].quantity == Decimal("6.000")


def test_missing_expiry_raises(db):
    item = make_perishable_product(db)
    with pytest.raises(BatchError):
        batch_service.restore_for_return(db, item=item, location_kind=LocationKind.warehouse,
                                         location_id=1, expiry_date=None, quantity=Decimal("1"))
