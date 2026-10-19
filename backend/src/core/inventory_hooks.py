from __future__ import annotations

from sqlalchemy import event, select
from sqlalchemy.orm import Session

_DOCS = {
    "StockTransfer": ("stock_transfer", "id"),
    "StockTransferLine": ("stock_transfer", "transfer_id"),
    "StockPermit": ("stock_permit", "id"),
    "StockPermitLine": ("stock_permit", "permit_id"),
    "StockCount": ("stock_count", "id"),
    "StockCountLine": ("stock_count", "count_id"),
    "WastageDocument": ("wastage", "id"),
    "ManufacturingOrder": ("manufacturing_order", "id"),
    "ManufacturingOrderConsumption": ("manufacturing_order", "order_id"),
    "ProductionOrder": ("production_order", "id"),
    "ProductionOrderProduct": ("production_order", "order_id"),
    "ProductionOrderReceipt": ("production_order", "order_id"),
    "ProductionOrderMaterial": ("production_order", "order_id"),
}


@event.listens_for(Session, "after_flush")
def _collect(session: Session, _ctx) -> None:
    if session.info.get("inventory_syncing"):
        return
    touched = session.info.setdefault("inventory_touched", set())
    for obj in (*session.new, *session.dirty, *session.deleted):
        name = type(obj).__name__
        if name == "StockMovement":
            if obj.source_doc_type and obj.source_doc_id:
                touched.add((obj.source_doc_type, int(obj.source_doc_id)))
            continue
        spec = _DOCS.get(name)
        if spec is not None:
            doc_id = getattr(obj, spec[1], None)
            if doc_id:
                touched.add((spec[0], int(doc_id)))


@event.listens_for(Session, "before_commit")
def _sync(session: Session) -> None:
    if session.info.get("inventory_syncing"):
        return
    session.flush()
    touched = session.info.pop("inventory_touched", set())
    if not touched:
        return
    from src.models.org import Branch
    from src.models.perpetual import InventoryPosting
    from src.services import perpetual_service

    relevant = [(t, i) for t, i in touched
                if (perpetual_service.canonical(t) or t).replace("reverse_", "")
                in (*perpetual_service.MOVEMENT_DOCS, "manufacturing")]
    if not relevant:
        return
    enabled = session.scalar(select(Branch.id).where(Branch.perpetual_from.is_not(None)).limit(1))
    if enabled is None and session.scalar(select(InventoryPosting.id).limit(1)) is None:
        return
    session.info["inventory_syncing"] = True
    try:
        for doc_type, doc_id in sorted(relevant):
            perpetual_service.sync_doc(session, doc_type, doc_id)
        session.flush()
    finally:
        session.info["inventory_syncing"] = False
        session.info.pop("inventory_touched", None)
