"""011 FR-002/003: the reorder report flags items below min_stock or above max_stock (advisory)."""
from decimal import Decimal

from src.models.stock import LocationKind, StockDirection
from src.services import stock_report, stock_service
from tests.conftest import make_perishable_product, make_priced_product


def _stock_in(db, item, qty, user_id):
    stock_service.post_movement(
        db, item_id=item.id, location_kind=LocationKind.warehouse, location_id=1,
        movement_type="seed_in", direction=StockDirection.in_, quantity=Decimal(qty),
        actor_user_id=user_id,
    )


def test_below_min_flagged(db, world):
    item = make_priced_product(db, name="LowStock")
    item.min_stock = Decimal("10")
    db.flush()
    _stock_in(db, item, "3", world["admin"])
    rows = stock_report.reorder(db)
    row = next(r for r in rows if r.item_id == item.id)
    assert row.flag == "below_min"
    assert row.on_hand == Decimal("3.000")


def test_above_max_flagged(db, world):
    item = make_priced_product(db, name="OverStock")
    item.max_stock = Decimal("5")
    db.flush()
    _stock_in(db, item, "9", world["admin"])
    rows = stock_report.reorder(db)
    row = next(r for r in rows if r.item_id == item.id)
    assert row.flag == "above_max"


def test_within_bounds_not_flagged(db, world):
    item = make_perishable_product(db, name="OkStock", min_stock="2", max_stock="20")
    _stock_in(db, item, "5", world["admin"])
    rows = stock_report.reorder(db)
    assert all(r.item_id != item.id for r in rows)
