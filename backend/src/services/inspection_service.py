"""Site inspections (معاينات) — 015-inspections-mobile.

Creates inspection documents (technician/regular visits) with item lines and point totals.
Sync is idempotent: a record whose `client_uuid` already exists is returned unchanged, so the
mobile app can safely retry a batch after a dropped connection.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from src.core.money import to_qty
from src.models.catalog import Item
from src.models.inspection import Inspection, InspectionItem, VisitKind
from src.services import audit_service


class InspectionError(Exception):
    pass


@dataclass(frozen=True)
class LineIn:
    item_id: int | None
    item_name: str
    quantity: Decimal
    points: Decimal


def _doc_number(db: Session) -> str:
    n = db.scalar(select(func.count()).select_from(Inspection)) or 0
    return f"INSP-{n + 1:06d}"


def _points(value) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.001"))


def create_inspection(
    db: Session, *, visit_kind: VisitKind, inspection_date: date, owner_name: str,
    rep_user_id: int, actor_user_id: int, lines: list[LineIn],
    owner_phone: str | None = None, national_id: str | None = None,
    owner_address: str | None = None, floor_number: str | None = None,
    description: str | None = None, inspection_type: str | None = None,
    technician_name: str | None = None, technician_phone: str | None = None,
    purchase_shop: str | None = None, visit_details: str | None = None,
    client_uuid: str | None = None,
) -> Inspection:
    if not owner_name or not owner_name.strip():
        raise InspectionError("Owner name is required.")

    # Idempotent sync: the device retries whole batches — an already-synced UUID is a no-op.
    if client_uuid:
        existing = db.scalar(select(Inspection).where(Inspection.client_uuid == client_uuid))
        if existing is not None:
            return existing

    insp = Inspection(
        document_number=_doc_number(db), client_uuid=client_uuid, visit_kind=visit_kind,
        inspection_date=inspection_date, owner_name=owner_name.strip(), owner_phone=owner_phone,
        national_id=national_id, owner_address=owner_address, floor_number=floor_number,
        description=description, inspection_type=inspection_type,
        technician_name=technician_name, technician_phone=technician_phone,
        purchase_shop=purchase_shop, visit_details=visit_details,
        total_points=_points(0), rep_user_id=rep_user_id,
    )
    db.add(insp)
    db.flush()

    total = Decimal("0")
    for ln in lines:
        qty = to_qty(ln.quantity)
        if qty <= 0:
            raise InspectionError("Line quantity must be positive.")
        # Snapshot the name so the record survives later catalog renames/removals.
        name = ln.item_name
        if ln.item_id is not None:
            item = db.get(Item, ln.item_id)
            if item is not None:
                name = item.name
        line_total = _points(_points(ln.points) * qty)
        db.add(InspectionItem(
            inspection_id=insp.id, item_id=ln.item_id, item_name=name, quantity=qty,
            points=_points(ln.points), total=line_total,
        ))
        total += line_total
    insp.total_points = _points(total)
    db.flush()
    audit_service.record(db, action="inspection.create", actor_user_id=actor_user_id,
                         entity_type="inspection", entity_id=insp.id,
                         after={"doc": insp.document_number, "points": str(insp.total_points)})
    return insp


def list_inspections(
    db: Session, *, visit_kind: VisitKind | None = None, rep_user_id: int | None = None,
    date_from: date | None = None, date_to: date | None = None,
) -> list[Inspection]:
    stmt = select(Inspection).options(selectinload(Inspection.items))
    if visit_kind is not None:
        stmt = stmt.where(Inspection.visit_kind == visit_kind)
    if rep_user_id is not None:
        stmt = stmt.where(Inspection.rep_user_id == rep_user_id)
    if date_from is not None:
        stmt = stmt.where(Inspection.inspection_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(Inspection.inspection_date <= date_to)
    return db.scalars(stmt.order_by(Inspection.inspection_date.desc(), Inspection.id.desc())).all()


def get_inspection(db: Session, inspection_id: int) -> Inspection | None:
    return db.scalar(
        select(Inspection).options(selectinload(Inspection.items))
        .where(Inspection.id == inspection_id)
    )
