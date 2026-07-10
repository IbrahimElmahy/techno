"""Standalone wastage / scrap documents (014-production-reporting).

Writes off stock outside a manufacturing order (damage/expiry/spoilage): posts one `waste_out`
movement (no-negative enforced) and stores a costed document. Reversible once, like other docs.
"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money, to_qty
from src.lib import production
from src.models.catalog import Item
from src.models.stock import LocationKind, StockDirection
from src.models.wastage import WastageDocument
from src.services import audit_service, stock_service


class WastageError(Exception):
    pass


def _doc_number(db: Session) -> str:
    n = db.scalar(select(func.count()).select_from(WastageDocument)) or 0
    return f"WASTE-{n + 1:06d}"


def create_wastage(
    db: Session, *, item_id: int, warehouse_id: int, quantity, reason: str | None,
    actor_user_id: int,
) -> WastageDocument:
    qty = to_qty(quantity)
    if qty <= to_qty(0):
        raise WastageError("Wastage quantity must be positive.")
    item = db.get(Item, item_id)
    if item is None:
        raise WastageError("Item not found.")
    unit_cost = to_money(item.purchase_price) if item.purchase_price is not None else ZERO
    doc = WastageDocument(
        document_number=_doc_number(db), item_id=item_id, warehouse_id=warehouse_id, quantity=qty,
        unit_cost=unit_cost, total_cost=production.line_cost(qty, unit_cost), reason=reason,
        stock_movement_id=0, actor_user_id=actor_user_id,
    )
    db.add(doc)
    db.flush()
    mv = stock_service.post_movement(
        db, item_id=item_id, location_kind=LocationKind.warehouse, location_id=warehouse_id,
        movement_type="waste_out", direction=StockDirection.out, quantity=qty,
        actor_user_id=actor_user_id, source_doc_type="wastage", source_doc_id=doc.id,
    )
    doc.stock_movement_id = mv.id
    db.flush()
    audit_service.record(db, action="wastage.create", actor_user_id=actor_user_id,
                         entity_type="wastage_document", entity_id=doc.id,
                         after={"doc": doc.document_number, "cost": str(doc.total_cost)})
    return doc


def reverse_wastage(db: Session, *, wastage_id: int, actor_user_id: int) -> WastageDocument:
    original = db.get(WastageDocument, wastage_id)
    if original is None:
        raise WastageError("Wastage document not found.")
    if original.reverses_id is not None:
        raise WastageError("A reversal is itself not re-reversible.")
    if db.scalar(select(WastageDocument).where(WastageDocument.reverses_id == wastage_id)) is not None:
        raise WastageError("Document already reversed (reverse-once).")
    mirror = stock_service.reverse_movement(
        db, original_id=original.stock_movement_id, actor_user_id=actor_user_id,
        movement_type="reverse_waste_out",
    )
    rev = WastageDocument(
        document_number=_doc_number(db), item_id=original.item_id,
        warehouse_id=original.warehouse_id, quantity=original.quantity, unit_cost=original.unit_cost,
        total_cost=original.total_cost, reason=original.reason, stock_movement_id=mirror.id,
        reverses_id=wastage_id, actor_user_id=actor_user_id,
    )
    db.add(rev)
    db.flush()
    audit_service.record(db, action="wastage.reverse", actor_user_id=actor_user_id,
                         entity_type="wastage_document", entity_id=rev.id, before={"doc": wastage_id})
    return rev


def list_wastage(db: Session):
    return db.scalars(select(WastageDocument).order_by(WastageDocument.id.desc())).all()


def get_wastage(db: Session, wastage_id: int) -> WastageDocument | None:
    return db.get(WastageDocument, wastage_id)
