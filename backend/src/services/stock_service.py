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
        raise StockError("Movement quantity must be positive.")
    _lock_locator(db, item_id, location_kind, location_id)
    if direction == StockDirection.out:
        current = on_hand(db, item_id, location_kind, location_id)
        if current - q < ZERO_QTY:
            raise StockError(
                f"No-negative-stock: on-hand {current} < requested out {q} "
                f"(item {item_id}, {location_kind.value} {location_id})."
            )
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
        raise StockError("Original movement not found.")
    if original.reverses_movement_id is not None:
        raise StockError("A reversal movement is itself not re-reversible.")
    existing = db.scalar(
        select(StockMovement).where(StockMovement.reverses_movement_id == original_id)
    )
    if existing is not None:
        raise StockError("Movement already reversed (reverse-once).")
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
