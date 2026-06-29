"""T007: point balance = Σ delta; may go negative. FR-005; SC-002."""
from sqlalchemy import inspect

from src.models.customer import Customer
from src.models.loyalty import PointKind, PointRecord
from src.services.point_service import balance


def _customer(db):
    c = Customer(code="C-PT", name="Pts", customer_type="trader", rep_id=1, territory_id=1)
    db.add(c)
    db.flush()
    return c


def _rec(db, customer_id, kind, delta):
    r = PointRecord(customer_id=customer_id, kind=kind, delta=delta)
    db.add(r)
    db.flush()
    return r


def test_balance_is_signed_sum(db):
    c = _customer(db)
    _rec(db, c.id, PointKind.earn, 15)
    _rec(db, c.id, PointKind.converted, -10)
    _rec(db, c.id, PointKind.void_reclaim, 4)
    db.commit()
    assert balance(db, c.id) == 9


def test_balance_can_go_negative(db):
    c = _customer(db)
    _rec(db, c.id, PointKind.earn, 5)
    _rec(db, c.id, PointKind.reverse, -3)
    _rec(db, c.id, PointKind.adjustment, -8)  # return against already-redeemed points
    db.commit()
    assert balance(db, c.id) == -6


def test_no_stored_balance_column():
    cols = {col.key for col in inspect(Customer).columns}
    assert not any(k in cols for k in ("point_balance", "points", "loyalty_points"))
