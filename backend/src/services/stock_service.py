"""Stock service (T015–T017): post_movement, on_hand, reverse_movement.

The only write path into stock. On-hand is derived from immutable movements (FR-007); writes are
serialized per (item × location) via a `stock_locator` FOR UPDATE lock so No-Negative-Stock holds
under concurrency without a stored balance (Principle XI / research R3). Reversal mirrors direction
(FR-025); reverse-once enforced.
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.money import ZERO_QTY, to_qty
from src.models.stock import (
    LocationKind,
    StockDirection,
    StockLocator,
    StockMovement,
)


class StockError(Exception):
    """Invalid stock operation (no-negative-stock, double reversal, ...)."""


def _lock_locator(db: Session, item_id: int, location_kind: LocationKind, location_id: int) -> None:
    """Get-or-create the (item × location) locator and lock it for the rest of the txn."""
    loc = db.scalar(
        select(StockLocator)
        .where(
            StockLocator.item_id == item_id,
            StockLocator.location_kind == location_kind,
            StockLocator.location_id == location_id,
        )
        .with_for_update()
    )
    if loc is None:
        loc = StockLocator(item_id=item_id, location_kind=location_kind, location_id=location_id)
        db.add(loc)
        db.flush()
        # Re-select with the lock now that the row exists.
        db.scalar(
            select(StockLocator).where(StockLocator.id == loc.id).with_for_update()
        )



def _branch_of(db: Session, location_kind, location_id: int) -> int | None:
    """فرع المكان: المخزن بيقول فرعه، والعهدة بتقول فرع المندوب."""
    kind = getattr(location_kind, "value", location_kind)
    if kind == "warehouse":
        from src.models.warehouse import Warehouse

        wh = db.get(Warehouse, location_id)
        return wh.branch_id if wh else None
    if kind == "rep":
        from src.models.user import User

        rep = db.get(User, location_id)
        return rep.branch_id if rep else None
    return None


def on_hand(db: Session, item_id: int, location_kind: LocationKind, location_id: int) -> Decimal:
    """Derived on-hand = Σ(in − out) for the (item × location)."""
    total = ZERO_QTY
    rows = db.scalars(
        select(StockMovement).where(
            StockMovement.item_id == item_id,
            StockMovement.location_kind == location_kind,
            StockMovement.location_id == location_id,
        )
    ).all()
    for mv in rows:
        q = to_qty(mv.quantity)
        total += q if mv.direction == StockDirection.in_ else -q
    return to_qty(total)


def _label(db, location_kind: LocationKind, location_id: int) -> str:
    """اسم المكان زي ما الناس بتناديه — «مخزن الفرع»، مش «warehouse 3»."""
    from src.models.warehouse import Custody, Warehouse

    if location_kind == LocationKind.warehouse:
        wh = db.get(Warehouse, location_id)
        return wh.name if wh and wh.name else f"مخزن #{location_id}"
    cust = db.get(Custody, location_id)
    if cust is None:
        return f"عهدة #{location_id}"
    # A custody is held EITHER by a rep or by a warehouse — `holder_type` says which, and the two
    # ids are nullable accordingly. This read `cust.user_id`, which the model has never had, so
    # every refusal on a custody raised AttributeError from inside the error message instead of
    # the refusal itself: the storekeeper got a 500 at the exact moment the system had something
    # useful to tell them. It went unseen because nothing had ever asked for a custody's label.
    if cust.rep_id is not None:
        from src.models.user import User
        user = db.get(User, cust.rep_id)
        who = (user.full_name or user.username) if user else f"#{cust.rep_id}"
        return f"عهدة {who}"
    if cust.warehouse_id is not None:
        wh = db.get(Warehouse, cust.warehouse_id)
        return f"عهدة {wh.name}" if wh and wh.name else f"عهدة مخزن #{cust.warehouse_id}"
    return f"عهدة #{location_id}"


def _not_enough(db, item_id: int, location_kind: LocationKind, location_id: int,
                available, wanted) -> str:
    """رسالة «الرصيد مايكفيش» — واحدة للنظام كله.

    Every writer that takes stock out — the sale, the transfer, the issue permit, manufacturing,
    the count adjustment — comes through `post_movement`, so this ONE sentence is what all of them
    say. Five services each wording the same refusal is how a system stops sounding like itself,
    and how one of them ends up saying something subtly different from the truth.

    It names the item and the place the way the people using it do. The message it replaces read
    «No-negative-stock: on-hand 5 < requested out 8 (item 12, warehouse 3)» — every fact a
    developer needs and not one a storekeeper can act on.
    """
    from src.models.catalog import Item

    item = db.get(Item, item_id)
    name = item.name if item and item.name else f"صنف #{item_id}"
    where = _label(db, location_kind, location_id)
    short = to_qty(wanted) - to_qty(available)
    return (
        f"الرصيد مايكفيش: «{name}» في {where} المتاح منه {to_qty(available)} "
        f"والمطلوب صرفه {to_qty(wanted)} — ناقص {short}."
    )


def post_movement(
    db: Session,
    *,
    item_id: int,
    location_kind: LocationKind,
    location_id: int,
    movement_type: str,
    direction: StockDirection,
    quantity: Decimal,
    actor_user_id: int,
    source_doc_type: str | None = None,
    source_doc_id: int | None = None,
    reverses_movement_id: int | None = None,
) -> StockMovement:
    """Append one immutable movement; reject an `out` that would drive on-hand below zero."""
    q = to_qty(quantity)
    if q <= ZERO_QTY:
        raise StockError("كمية الحركة لازم تكون أكبر من صفر.")
    _lock_locator(db, item_id, location_kind, location_id)
    if direction == StockDirection.out:
        current = on_hand(db, item_id, location_kind, location_id)
        if current - q < ZERO_QTY:
            raise StockError(_not_enough(db, item_id, location_kind, location_id, current, q))
    mv = StockMovement(
        item_id=item_id,
        location_kind=location_kind,
        location_id=location_id,
        movement_type=movement_type,
        direction=direction,
        quantity=q,
        source_doc_type=source_doc_type,
        source_doc_id=source_doc_id,
        reverses_movement_id=reverses_movement_id,
        actor_user_id=actor_user_id,
        # (037) فرع الحركة بيتاخد من مكانها، مش من اللي سجّلها.
        #
        # البضاعة بتتحرك في مكان، والمكان بيتبع فرع. كل مستند بيحرّك مخزون بيعدّي من هنا،
        # فسطر واحد بيغطّي البيع والشرا والمرتجعات والتحويلات والأذون والتصنيع — بدل ما كل
        # خدمة تفتكر تحطه لوحدها، واللي تنساه يفضل بره العزل في صمت.
        branch_id=_branch_of(db, location_kind, location_id),
    )
    db.add(mv)
    db.flush()
    return mv


def reverse_movement(
    db: Session, *, original_id: int, actor_user_id: int, movement_type: str | None = None
) -> StockMovement:
    """Post the mirror of a movement (direction swapped); reverse-once; obeys no-negative-stock."""
    original = db.get(StockMovement, original_id)
    if original is None:
        raise StockError("الحركة الأصلية مش موجودة.")
    if original.reverses_movement_id is not None:
        raise StockError("الحركة العكسية نفسها مايتعملهاش عكس.")
    existing = db.scalar(
        select(StockMovement).where(StockMovement.reverses_movement_id == original_id)
    )
    if existing is not None:
        raise StockError("الحركة دي اتعكست قبل كده.")
    mirror = (
        StockDirection.out if original.direction == StockDirection.in_ else StockDirection.in_
    )
    return post_movement(
        db,
        item_id=original.item_id,
        location_kind=original.location_kind,
        location_id=original.location_id,
        movement_type=movement_type or f"reverse_{original.movement_type}",
        direction=mirror,
        quantity=original.quantity,
        actor_user_id=actor_user_id,
        source_doc_type=original.source_doc_type,
        source_doc_id=original.source_doc_id,
        reverses_movement_id=original_id,
    )
