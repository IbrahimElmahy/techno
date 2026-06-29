"""T010: on-hand = Σ(in−out); quantity-only (no value/COGS). FR-007/008a; SC-002."""
from decimal import Decimal

from sqlalchemy import inspect

from src.models.catalog import Item, ItemKind
from src.models.ledger import AccountType
from src.models.stock import LocationKind, StockLocator, StockMovement, StockDirection
from src.services.stock_service import on_hand, post_movement


def _item(db) -> Item:
    it = Item(code="RM-1", name="Steel", kind=ItemKind.raw_material, unit_of_measure="kg")
    db.add(it)
    db.flush()
    return it


def test_on_hand_is_signed_sum_of_movements(db):
    it = _item(db)
    loc = (LocationKind.warehouse, 1)
    post_movement(db, item_id=it.id, location_kind=loc[0], location_id=loc[1],
                  movement_type="purchase_in", direction=StockDirection.in_,
                  quantity=Decimal("100"), actor_user_id=1)
    out = post_movement(db, item_id=it.id, location_kind=loc[0], location_id=loc[1],
                        movement_type="sale_out", direction=StockDirection.out,
                        quantity=Decimal("30"), actor_user_id=1)
    db.commit()
    assert on_hand(db, it.id, loc[0], loc[1]) == Decimal("70.000")
    # Reverse the out -> back to 100.
    from src.services.stock_service import reverse_movement
    reverse_movement(db, original_id=out.id, actor_user_id=1)
    db.commit()
    assert on_hand(db, it.id, loc[0], loc[1]) == Decimal("100.000")


def test_stock_is_quantity_only_no_value_column():
    cols = {c.key for c in inspect(StockMovement).columns}
    assert not any(k in cols for k in ("amount", "value", "money", "cost", "total"))


def test_no_inventory_or_cogs_account_type():
    names = {a.value for a in AccountType}
    assert not any("inventory" in n or "cogs" in n for n in names)


def test_locator_stores_no_quantity():
    cols = {c.key for c in inspect(StockLocator).columns}
    assert not any(k in cols for k in ("quantity", "on_hand", "balance"))
