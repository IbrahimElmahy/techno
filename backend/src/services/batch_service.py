"""Expiry batches for perishable items — 011.

A perishable item is not tracked as one pile of stock but as lots, each with its own expiry date.
Selling draws from the lot that expires soonest (FEFO), which is what stops newer stock going out
while older stock quietly goes bad on the shelf.

The invariant everything here protects: **for a perishable item at a location, the sum of its batch
quantities equals its derived on-hand there**. Every operation moves both sides together — receive
adds a batch AND posts a stock-in, a sale depletes batches AND posts a stock-out. If they were
allowed to drift, the expiry report would describe stock that isn't there.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.money import to_qty
from src.models.catalog import Item, StockBatch
from src.models.stock import LocationKind, StockDirection
from src.services import stock_service

ZERO_QTY = Decimal("0.000")


class BatchError(Exception):
    """Invalid batch operation (not perishable, missing expiry, insufficient lots, ...)."""


def _require_perishable(item: Item) -> None:
    if not item.is_perishable:
        raise BatchError("Batches apply to perishable items only.")


def _find(db: Session, item_id: int, kind: LocationKind, loc_id: int,
          expiry: date) -> StockBatch | None:
    return db.scalar(
        select(StockBatch).where(
            StockBatch.item_id == item_id,
            StockBatch.location_kind == kind,
            StockBatch.location_id == loc_id,
            StockBatch.expiry_date == expiry,
        )
    )


def _upsert(db: Session, *, item_id: int, kind: LocationKind, loc_id: int,
            expiry: date, quantity: Decimal) -> StockBatch:
    """Add to the lot with this exact expiry at this location, creating it the first time.

    Two deliveries of the same item expiring the same day are the same lot — keeping them apart
    would just make the expiry report longer without telling anyone anything new.
    """
    batch = _find(db, item_id, kind, loc_id, expiry)
    if batch is None:
        batch = StockBatch(item_id=item_id, location_kind=kind, location_id=loc_id,
                           expiry_date=expiry, quantity=to_qty(quantity))
        db.add(batch)
    else:
        batch.quantity = to_qty(Decimal(str(batch.quantity)) + to_qty(quantity))
    db.flush()
    return batch


def receive(db: Session, *, item_id: int, location_kind: LocationKind, location_id: int,
            expiry_date: date, quantity: Decimal, actor_user_id: int) -> StockBatch:
    """Take a lot into stock: register the batch and post the matching stock-in."""
    item = db.get(Item, item_id)
    if item is None:
        raise BatchError("Item not found.")
    _require_perishable(item)
    qty = to_qty(quantity)
    if qty <= ZERO_QTY:
        raise BatchError("Batch quantity must be greater than zero.")
    if expiry_date is None:
        raise BatchError("A batch needs an expiry date.")

    stock_service.post_movement(
        db, item_id=item_id, location_kind=location_kind, location_id=location_id,
        movement_type="batch_in", direction=StockDirection.in_, quantity=qty,
        actor_user_id=actor_user_id, source_doc_type="batch_receive", source_doc_id=None,
    )
    return _upsert(db, item_id=item_id, kind=location_kind, loc_id=location_id,
                   expiry=expiry_date, quantity=qty)


def consume_fefo(db: Session, *, item_id: int, location_kind: LocationKind, location_id: int,
                 quantity: Decimal) -> list[tuple[date, Decimal]]:
    """Draw `quantity` from the lots that expire soonest. Returns what came from each lot.

    Only the batch side moves here — the caller (a sale) posts its own stock-out, so the two stay
    in step. A shortfall is refused rather than partially applied: half a sale is worse than none.
    """
    item = db.get(Item, item_id)
    if item is None:
        raise BatchError("Item not found.")
    _require_perishable(item)
    needed = to_qty(quantity)
    if needed <= ZERO_QTY:
        raise BatchError("Consumed quantity must be greater than zero.")

    batches = db.scalars(
        select(StockBatch).where(
            StockBatch.item_id == item_id,
            StockBatch.location_kind == location_kind,
            StockBatch.location_id == location_id,
            StockBatch.quantity > 0,
        ).order_by(StockBatch.expiry_date, StockBatch.id)   # earliest expiry, then oldest lot
    ).all()

    available = to_qty(sum((Decimal(str(b.quantity)) for b in batches), ZERO_QTY))
    if needed > available:
        raise BatchError(
            f"Insufficient batch quantity: need {needed}, {available} available in lots."
        )

    taken: list[tuple[date, Decimal]] = []
    remaining = needed
    for batch in batches:
        if remaining <= ZERO_QTY:
            break
        have = to_qty(Decimal(str(batch.quantity)))
        use = have if have <= remaining else remaining
        batch.quantity = to_qty(have - use)
        remaining = to_qty(remaining - use)
        taken.append((batch.expiry_date, use))
    db.flush()
    return taken


def restore_for_return(db: Session, *, item_id: int, location_kind: LocationKind,
                       location_id: int, expiry_date: date, quantity: Decimal) -> StockBatch:
    """Put returned goods back into the lot for their expiry date.

    The caller's return already posts the stock-in; this only moves the batch side. The expiry has
    to be supplied because a sale does not record which lot each unit came from — asking for it
    keeps the batch sum honest instead of guessing a date.
    """
    item = db.get(Item, item_id)
    if item is None:
        raise BatchError("Item not found.")
    _require_perishable(item)
    if expiry_date is None:
        raise BatchError("A perishable return needs the expiry date of the goods coming back.")
    qty = to_qty(quantity)
    if qty <= ZERO_QTY:
        raise BatchError("Returned quantity must be greater than zero.")
    return _upsert(db, item_id=item_id, kind=location_kind, loc_id=location_id,
                   expiry=expiry_date, quantity=qty)


def expiring(db: Session, *, before: date, item_id: int | None = None,
             location_kind: LocationKind | None = None,
             location_id: int | None = None) -> list[dict]:
    """Lots at or before a cutoff date that still hold stock — soonest first."""
    stmt = select(StockBatch, Item).join(Item, Item.id == StockBatch.item_id).where(
        StockBatch.expiry_date <= before,
        StockBatch.quantity > 0,
    )
    if item_id is not None:
        stmt = stmt.where(StockBatch.item_id == item_id)
    if location_kind is not None:
        stmt = stmt.where(StockBatch.location_kind == location_kind)
    if location_id is not None:
        stmt = stmt.where(StockBatch.location_id == location_id)

    return [
        {
            "batch_id": b.id, "item_id": b.item_id, "code": item.code, "name": item.name,
            "location_kind": b.location_kind.value, "location_id": b.location_id,
            "expiry_date": str(b.expiry_date), "quantity": str(to_qty(b.quantity)),
        }
        for b, item in db.execute(
            stmt.order_by(StockBatch.expiry_date, StockBatch.id)
        ).all()
    ]


def on_hand_in_batches(db: Session, *, item_id: int, location_kind: LocationKind,
                       location_id: int) -> Decimal:
    """Total across the item's lots at a location — the figure that must equal derived on-hand."""
    rows = db.scalars(
        select(StockBatch.quantity).where(
            StockBatch.item_id == item_id,
            StockBatch.location_kind == location_kind,
            StockBatch.location_id == location_id,
        )
    ).all()
    return to_qty(sum((Decimal(str(q)) for q in rows), ZERO_QTY)) if rows else ZERO_QTY
