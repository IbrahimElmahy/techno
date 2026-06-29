"""T011: No-Negative-Stock at write time. FR-008; Principle XI; SC-001."""
from decimal import Decimal

import pytest

from src.models.catalog import Item, ItemKind
from src.models.stock import LocationKind, StockDirection
from src.services.stock_service import StockError, on_hand, post_movement


def _item(db) -> Item:
    it = Item(code="P-1", name="Widget", kind=ItemKind.product, unit_of_measure="piece")
    db.add(it)
    db.flush()
    return it


def _in(db, item_id, q):
    return post_movement(db, item_id=item_id, location_kind=LocationKind.custody, location_id=9,
                         movement_type="transfer_in", direction=StockDirection.in_,
                         quantity=Decimal(q), actor_user_id=1)


def _out(db, item_id, q):
    return post_movement(db, item_id=item_id, location_kind=LocationKind.custody, location_id=9,
                         movement_type="sale_out", direction=StockDirection.out,
                         quantity=Decimal(q), actor_user_id=1)


def test_out_equal_to_on_hand_allowed(db):
    it = _item(db)
    _in(db, it.id, "50")
    _out(db, it.id, "50")
    db.commit()
    assert on_hand(db, it.id, LocationKind.custody, 9) == Decimal("0.000")


def test_out_exceeding_on_hand_rejected(db):
    it = _item(db)
    _in(db, it.id, "50")
    with pytest.raises(StockError):
        _out(db, it.id, "60")


def test_sequential_outs_cannot_drive_negative(db):
    it = _item(db)
    _in(db, it.id, "10")
    _out(db, it.id, "7")
    db.commit()
    with pytest.raises(StockError):
        _out(db, it.id, "4")  # only 3 remain
