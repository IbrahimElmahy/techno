"""Expiry-batch service (011).

Owns the batch lifecycle for perishable items: receive (in), FEFO consume (out on sale), restore
(in on return), and the expiring report. Every batch change is paired with a 002 quantity movement
(the caller posts receive/return movements; the sale posts its own stock-out) so the batch-quantity
sum at a location equals the item's derived on-hand there. Perishable items sell in the base unit.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.money import ZERO_QTY, to_qty
from src.models.catalog import Item
from src.models.stock import LocationKind, StockBatch, StockDirection
from src.services import stock_service


class BatchError(Exception):
    """Invalid batch operation (not perishable, alternate unit, missing expiry, shortfall)."""


ONE = Decimal("1")


def _find(
    db: Session, item_id: int, kind: LocationKind, loc: int, expiry: date
) -> StockBatch | None:
    return db.scalar(
        select(StockBatch).where(
            StockBatch.item_id == item_id, StockBatch.location_kind == kind,
            StockBatch.location_id == loc, StockBatch.expiry_date == expiry,
        )
    )


def _upsert(
    db: Session, item_id: int, kind: LocationKind, loc: int, expiry: date, qty: Decimal
) -> StockBatch:
    row = _find(db, item_id, kind, loc, expiry)
    if row is None:
        row = StockBatch(item_id=item_id, location_kind=kind, location_id=loc,
                         expiry_date=expiry, quantity=to_qty(qty))
        db.add(row)
    else:
        row.quantity = to_qty(to_qty(row.quantity) + qty)
    db.flush()
    return row


def receive(
    db: Session, *, item: Item, location_kind: LocationKind, location_id: int,
    expiry_date: date, quantity: Decimal, actor_user_id: int,
) -> StockBatch:
    """Register a batch (upsert by expiry) and post a +quantity stock-in (FR-004)."""
    if not item.is_perishable:
        raise BatchError("Item is not perishable.")
    if to_qty(quantity) <= ZERO_QTY:
        raise BatchError("Quantity must be positive.")
    row = _upsert(db, item.id, location_kind, location_id, expiry_date, to_qty(quantity))
    stock_service.post_movement(
        db, item_id=item.id, location_kind=location_kind, location_id=location_id,
        movement_type="batch_receive_in", direction=StockDirection.in_, quantity=to_qty(quantity),
        actor_user_id=actor_user_id, source_doc_type="batch_receive", source_doc_id=item.id,
    )
    return row


def assert_base_unit(item: Item, unit_factor: Decimal) -> None:
    """Perishable items must transact in the base unit (factor 1) — FEFO is base-unit (FR-005)."""
    if item.is_perishable and to_qty(unit_factor) != to_qty(ONE):
        raise BatchError("Perishable items must be sold in the base unit (no alternate unit).")


def consume_fefo(
    db: Session, *, item: Item, location_kind: LocationKind, location_id: int, quantity: Decimal,
) -> None:
    """Deplete batches earliest-expiry-first for `quantity` (FR-005). Raise on shortfall."""
    remaining = to_qty(quantity)
    batches = db.scalars(
        select(StockBatch).where(
            StockBatch.item_id == item.id, StockBatch.location_kind == location_kind,
            StockBatch.location_id == location_id, StockBatch.quantity > 0,
        ).order_by(StockBatch.expiry_date, StockBatch.id)
    ).all()
    for b in batches:
        if remaining <= ZERO_QTY:
            break
        take = min(to_qty(b.quantity), remaining)
        b.quantity = to_qty(to_qty(b.quantity) - take)
        remaining = to_qty(remaining - take)
    if remaining > ZERO_QTY:
        raise BatchError("Insufficient batch quantity for the perishable sale.")
    db.flush()


def restore_for_return(
    db: Session, *, item: Item, location_kind: LocationKind, location_id: int,
    expiry_date: date | None, quantity: Decimal,
) -> None:
    """Restore returned quantity to a batch at the given expiry (FR-006). Missing expiry → error."""
    if expiry_date is None:
        raise BatchError("A perishable return requires an expiry_date for the restored batch.")
    _upsert(db, item.id, location_kind, location_id, expiry_date, to_qty(quantity))


def expiring(db: Session, *, before: date, item_id: int | None = None) -> list[StockBatch]:
    """Batches expiring on/before `before` with remaining quantity > 0, earliest first (FR-008)."""
    stmt = select(StockBatch).where(StockBatch.expiry_date <= before, StockBatch.quantity > 0)
    if item_id is not None:
        stmt = stmt.where(StockBatch.item_id == item_id)
    return list(db.scalars(stmt.order_by(StockBatch.expiry_date, StockBatch.id)).all())
