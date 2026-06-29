"""T012: movement reversal symmetry, reverse-once, immutability. FR-007/025; Principle IV."""
from decimal import Decimal

import pytest

from src.models.catalog import Item, ItemKind
from src.models.stock import LocationKind, StockDirection, StockImmutableError
from src.services.stock_service import StockError, post_movement, reverse_movement


def _item(db) -> Item:
    it = Item(code="RM-2", name="Resin", kind=ItemKind.raw_material, unit_of_measure="L")
    db.add(it)
    db.flush()
    return it


def test_reversal_mirrors_direction_and_links(db):
    it = _item(db)
    mv = post_movement(db, item_id=it.id, location_kind=LocationKind.warehouse, location_id=1,
                       movement_type="purchase_in", direction=StockDirection.in_,
                       quantity=Decimal("40"), actor_user_id=1)
    db.commit()
    rev = reverse_movement(db, original_id=mv.id, actor_user_id=1)
    db.commit()
    assert rev.direction == StockDirection.out  # mirror of 'in'
    assert rev.reverses_movement_id == mv.id
    assert rev.quantity == Decimal("40.000")


def test_reverse_once(db):
    it = _item(db)
    mv = post_movement(db, item_id=it.id, location_kind=LocationKind.warehouse, location_id=1,
                       movement_type="purchase_in", direction=StockDirection.in_,
                       quantity=Decimal("5"), actor_user_id=1)
    db.commit()
    reverse_movement(db, original_id=mv.id, actor_user_id=1)
    db.commit()
    with pytest.raises(StockError):
        reverse_movement(db, original_id=mv.id, actor_user_id=1)


def test_posted_movement_is_immutable(db):
    it = _item(db)
    mv = post_movement(db, item_id=it.id, location_kind=LocationKind.warehouse, location_id=1,
                       movement_type="purchase_in", direction=StockDirection.in_,
                       quantity=Decimal("5"), actor_user_id=1)
    db.commit()
    mv.quantity = Decimal("999")
    with pytest.raises(StockImmutableError):
        db.flush()
