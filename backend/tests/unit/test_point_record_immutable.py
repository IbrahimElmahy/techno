"""T008: point_record is immutable (append-only). FR-005; Principle IV."""
import pytest

from src.models.customer import Customer
from src.models.loyalty import PointKind, PointRecord, PointRecordImmutableError


def _customer(db):
    c = Customer(code="C-IM", name="Imm", customer_type="trader", rep_id=1, territory_id=1)
    db.add(c)
    db.flush()
    return c


def test_update_rejected(db):
    c = _customer(db)
    r = PointRecord(customer_id=c.id, kind=PointKind.earn, delta=10)
    db.add(r)
    db.commit()
    r.delta = 999
    with pytest.raises(PointRecordImmutableError):
        db.flush()


def test_delete_rejected(db):
    c = _customer(db)
    r = PointRecord(customer_id=c.id, kind=PointKind.earn, delta=10)
    db.add(r)
    db.commit()
    db.delete(r)
    with pytest.raises(PointRecordImmutableError):
        db.flush()
