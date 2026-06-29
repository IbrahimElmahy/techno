"""Manufacturing service (T028–T029). FR-013–016.

Two independent stock ops (no linkage, no BOM, no money). Each reversible via an explicit reverse
that posts a mirror stock movement (reverse-once).
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.models.catalog import Item, ItemKind
from src.models.manufacturing import ManufacturingOp, ManufactureOpType
from src.models.stock import LocationKind, StockDirection
from src.services import audit_service, stock_service


class ManufacturingError(Exception):
    pass


def _doc_number(db: Session) -> str:
    n = db.scalar(select(func.count()).select_from(ManufacturingOp)) or 0
    return f"MFG-{n + 1:06d}"


def _op(db, *, op_type, item_id, location_kind, location_id, quantity, movement_type, direction,
        actor_user_id, reverses_op_id=None) -> ManufacturingOp:
    op = ManufacturingOp(
        document_number=_doc_number(db), op_type=op_type, item_id=item_id,
        location_kind=location_kind, location_id=location_id, quantity=Decimal(quantity),
        stock_movement_id=0, reverses_op_id=reverses_op_id, actor_user_id=actor_user_id,
    )
    db.add(op)
    db.flush()
    mv = stock_service.post_movement(
        db, item_id=item_id, location_kind=location_kind, location_id=location_id,
        movement_type=movement_type, direction=direction, quantity=Decimal(quantity),
        actor_user_id=actor_user_id, source_doc_type="manufacturing", source_doc_id=op.id,
    )
    op.stock_movement_id = mv.id
    db.flush()
    audit_service.record(db, action=f"manufacturing.{op_type.value}", actor_user_id=actor_user_id,
                         entity_type="manufacturing_op", entity_id=op.id)
    return op


def consume(db, *, item_id, location_kind, location_id, quantity, actor_user_id) -> ManufacturingOp:
    item = db.get(Item, item_id)
    if item is None or item.kind != ItemKind.raw_material:
        raise ManufacturingError("Consume requires a raw material.")
    return _op(db, op_type=ManufactureOpType.consume, item_id=item_id, location_kind=location_kind,
               location_id=location_id, quantity=quantity, movement_type="consumption_out",
               direction=StockDirection.out, actor_user_id=actor_user_id)


def produce(db, *, item_id, location_kind, location_id, quantity, actor_user_id) -> ManufacturingOp:
    item = db.get(Item, item_id)
    if item is None or item.kind != ItemKind.product:
        raise ManufacturingError("Produce requires a product.")
    return _op(db, op_type=ManufactureOpType.produce, item_id=item_id, location_kind=location_kind,
               location_id=location_id, quantity=quantity, movement_type="production_in",
               direction=StockDirection.in_, actor_user_id=actor_user_id)


def reverse_op(db, *, op_id: int, actor_user_id: int) -> ManufacturingOp:
    """Reverse a consume/produce: mirror stock movement + a linked reversal op (reverse-once)."""
    original = db.get(ManufacturingOp, op_id)
    if original is None:
        raise ManufacturingError("Manufacturing op not found.")
    if original.reverses_op_id is not None:
        raise ManufacturingError("A reversal op is itself not re-reversible.")
    if db.scalar(select(ManufacturingOp).where(ManufacturingOp.reverses_op_id == op_id)) is not None:
        raise ManufacturingError("Op already reversed (reverse-once).")
    # Mirror the underlying movement (consume↔return-to-stock, produce↔remove); no-negative applies.
    mirror = stock_service.reverse_movement(
        db, original_id=original.stock_movement_id, actor_user_id=actor_user_id,
        movement_type=f"reverse_{original.op_type.value}",
    )
    rev = ManufacturingOp(
        document_number=_doc_number(db), op_type=original.op_type, item_id=original.item_id,
        location_kind=original.location_kind, location_id=original.location_id,
        quantity=original.quantity, stock_movement_id=mirror.id, reverses_op_id=op_id,
        actor_user_id=actor_user_id,
    )
    db.add(rev)
    db.flush()
    audit_service.record(db, action="manufacturing.reverse", actor_user_id=actor_user_id,
                         entity_type="manufacturing_op", entity_id=rev.id,
                         before={"op": op_id})
    return rev
