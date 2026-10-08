from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.money import to_qty
from src.models.catalog import (
    BatchMovementKind, StockBatchMovement, Item, StockBatch,
)
from src.models.stock import LocationKind, StockDirection, StockDoc
from src.services import stock_service

ZERO_QTY = Decimal("0.000")


class BatchError(Exception):
    pass


def _log(
    db: Session, *, item_id: int, expiry, location_kind: LocationKind, location_id: int,
    kind: BatchMovementKind, quantity, document_type: str | None = None,
    document_id: int | None = None, actor_user_id: int | None = None,
) -> None:
    db.add(StockBatchMovement(
        item_id=item_id, expiry_date=expiry, location_kind=location_kind,
        location_id=location_id, kind=kind, quantity=quantity,
        document_type=document_type, document_id=document_id, actor_user_id=actor_user_id,
    ))


def _require_perishable(item: Item) -> None:
    if not item.is_perishable:
        raise BatchError("الدفعات بتتعمل للأصناف اللي ليها صلاحية بس.")


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
    item = db.get(Item, item_id)
    if item is None:
        raise BatchError("الصنف مش موجود.")
    _require_perishable(item)
    qty = to_qty(quantity)
    if qty <= ZERO_QTY:
        raise BatchError("كمية الدفعة لازم تكون أكبر من صفر.")
    if expiry_date is None:
        raise BatchError("الدفعة لازم يكون ليها تاريخ صلاحية.")

    stock_service.post_movement(
        db, item_id=item_id, location_kind=location_kind, location_id=location_id,
        movement_type="batch_in", direction=StockDirection.in_, quantity=qty,
        actor_user_id=actor_user_id, source_doc_type="batch_receive", source_doc_id=None,
    )
    batch = _upsert(db, item_id=item_id, kind=location_kind, loc_id=location_id,
                    expiry=expiry_date, quantity=qty)
    _log(db, item_id=item_id, expiry=expiry_date, location_kind=location_kind,
         location_id=location_id, kind=BatchMovementKind.received, quantity=qty,
         document_type="batch_receive", actor_user_id=actor_user_id)
    return batch


def add_to_lot(db: Session, *, item_id: int, location_kind: LocationKind, location_id: int,
               expiry_date: date, quantity: Decimal,
               document_type: str | None = None, document_id: int | None = None,
               actor_user_id: int | None = None) -> StockBatch:
    item = db.get(Item, item_id)
    if item is None:
        raise BatchError("الصنف مش موجود.")
    _require_perishable(item)
    qty = to_qty(quantity)
    if qty <= ZERO_QTY:
        raise BatchError("كمية الدفعة لازم تكون أكبر من صفر.")
    if expiry_date is None:
        raise BatchError("الدفعة لازم يكون ليها تاريخ صلاحية.")
    batch = _upsert(db, item_id=item_id, kind=location_kind, loc_id=location_id,
                    expiry=expiry_date, quantity=qty)
    _log(db, item_id=item_id, expiry=expiry_date, location_kind=location_kind,
         location_id=location_id, kind=BatchMovementKind.received, quantity=qty,
         document_type=document_type, document_id=document_id, actor_user_id=actor_user_id)
    return batch


def consume_fefo(db: Session, *, item_id: int, location_kind: LocationKind, location_id: int,
                 quantity: Decimal, log_kind: BatchMovementKind | None = None,
                 document_type: str | None = None, document_id: int | None = None,
                 actor_user_id: int | None = None) -> list[tuple[date, Decimal]]:
    item = db.get(Item, item_id)
    if item is None:
        raise BatchError("الصنف مش موجود.")
    _require_perishable(item)
    needed = to_qty(quantity)
    if needed <= ZERO_QTY:
        raise BatchError("الكمية المستهلكة لازم تكون أكبر من صفر.")

    batches = db.scalars(
        select(StockBatch).where(
            StockBatch.item_id == item_id,
            StockBatch.location_kind == location_kind,
            StockBatch.location_id == location_id,
            StockBatch.quantity > 0,
        ).order_by(StockBatch.expiry_date, StockBatch.id)
    ).all()

    available = to_qty(sum((Decimal(str(b.quantity)) for b in batches), ZERO_QTY))
    if needed > available:
        raise BatchError(
            f"الدفعات مش كفاية — محتاج {needed} والمتاح فيها {available}."
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
        _log(db, item_id=item_id, expiry=batch.expiry_date, location_kind=location_kind,
             location_id=location_id, kind=log_kind or BatchMovementKind.consumed, quantity=use,
             document_type=document_type, document_id=document_id, actor_user_id=actor_user_id)
    db.flush()
    return taken


def relocate(db: Session, *, item_id: int, from_kind: LocationKind, from_id: int,
             to_kind: LocationKind, to_id: int, quantity: Decimal,
             transfer_id: int | None = None,
             actor_user_id: int | None = None) -> list[tuple[date, Decimal]]:
    item = db.get(Item, item_id)
    if item is None:
        raise BatchError("الصنف مش موجود.")
    if not getattr(item, "is_perishable", False):
        return []
    taken = consume_fefo(db, item_id=item_id, location_kind=from_kind, location_id=from_id,
                         quantity=quantity, log_kind=BatchMovementKind.relocated_out,
                         document_type=StockDoc.TRANSFER, document_id=transfer_id,
                         actor_user_id=actor_user_id)
    for expiry, qty in taken:
        _upsert(db, item_id=item_id, kind=to_kind, loc_id=to_id, expiry=expiry, quantity=qty)
        _log(db, item_id=item_id, expiry=expiry, location_kind=to_kind, location_id=to_id,
             kind=BatchMovementKind.relocated_in, quantity=qty,
             document_type=StockDoc.TRANSFER, document_id=transfer_id, actor_user_id=actor_user_id)
    db.flush()
    return taken


def restore_for_return(db: Session, *, item_id: int, location_kind: LocationKind,
                       location_id: int, expiry_date: date, quantity: Decimal,
                       invoice_id: int | None = None,
                       actor_user_id: int | None = None) -> StockBatch:
    item = db.get(Item, item_id)
    if item is None:
        raise BatchError("الصنف مش موجود.")
    _require_perishable(item)
    if expiry_date is None:
        raise BatchError("المرتجع لصنف له صلاحية لازم تكتب تاريخ صلاحية البضاعة الراجعة.")
    qty = to_qty(quantity)
    if qty <= ZERO_QTY:
        raise BatchError("الكمية المرتجعة لازم تكون أكبر من صفر.")
    batch = _upsert(db, item_id=item_id, kind=location_kind, loc_id=location_id,
                    expiry=expiry_date, quantity=qty)
    _log(db, item_id=item_id, expiry=expiry_date, location_kind=location_kind,
         location_id=location_id, kind=BatchMovementKind.returned, quantity=qty,
         document_type=StockDoc.SALE, document_id=invoice_id, actor_user_id=actor_user_id)
    return batch


def expiring(db: Session, *, before: date, item_id: int | None = None,
             location_kind: LocationKind | None = None,
             location_id: int | None = None) -> list[dict]:
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
    rows = db.scalars(
        select(StockBatch.quantity).where(
            StockBatch.item_id == item_id,
            StockBatch.location_kind == location_kind,
            StockBatch.location_id == location_id,
        )
    ).all()
    return to_qty(sum((Decimal(str(q)) for q in rows), ZERO_QTY)) if rows else ZERO_QTY
