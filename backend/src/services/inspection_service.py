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
from src.models.stock import LocationKind, StockDirection, StockMovement
from src.models.warehouse import Custody
from src.services import audit_service, stock_service


class InspectionError(Exception):
    pass


def rep_custody(db: Session, rep_user_id: int) -> Custody | None:
    """The rep's active custody, or None (admins / reps not yet issued one)."""
    return db.scalar(select(Custody).where(
        Custody.rep_id == rep_user_id, Custody.active.is_(True)))


def rep_stock_location(db: Session, rep_user_id: int) -> tuple[LocationKind, int] | None:
    """Where the rep's carried goods live.

    A custody linked to a warehouse (e.g. «مخزن السياره ب») points at that warehouse — the
    company stocks it with ordinary transfers. An unlinked custody holds stock directly
    (central_to_rep transfers). None ⇒ no custody: inspections stay informational.
    """
    custody = rep_custody(db, rep_user_id)
    if custody is None:
        return None
    if custody.warehouse_id is not None:
        return (LocationKind.warehouse, custody.warehouse_id)
    return (LocationKind.custody, custody.id)


def location_holdings(
    db: Session, location_kind: LocationKind, location_id: int
) -> dict[int, Decimal]:
    """item_id -> on-hand at one location (derived from movements, Σ in − out)."""
    rows = db.scalars(select(StockMovement).where(
        StockMovement.location_kind == location_kind,
        StockMovement.location_id == location_id,
    )).all()
    totals: dict[int, Decimal] = {}
    for mv in rows:
        q = to_qty(mv.quantity)
        delta = q if mv.direction == StockDirection.in_ else -q
        totals[mv.item_id] = totals.get(mv.item_id, Decimal("0")) + delta
    return {item_id: qty for item_id, qty in totals.items() if qty > 0}


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

    # When the recording rep holds a custody, every identified item line deducts from his
    # stock location (custody or its linked car warehouse) — the rep can only install what he
    # actually carries (no-negative enforced by stock_service).
    stock_loc = rep_stock_location(db, rep_user_id)

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
        line = InspectionItem(
            inspection_id=insp.id, item_id=ln.item_id, item_name=name, quantity=qty,
            points=_points(ln.points), total=line_total,
        )
        db.add(line)
        db.flush()
        if stock_loc is not None and ln.item_id is not None:
            try:
                mv = stock_service.post_movement(
                    db, item_id=ln.item_id, location_kind=stock_loc[0],
                    location_id=stock_loc[1], movement_type="inspection_out",
                    direction=StockDirection.out, quantity=qty, actor_user_id=actor_user_id,
                    source_doc_type="inspection", source_doc_id=insp.id,
                )
            except stock_service.StockError as exc:
                raise InspectionError(
                    f"الرصيد غير كافٍ في عهدتك للصنف «{name}» — المتاح أقل من {qty}."
                ) from exc
            line.stock_movement_id = mv.id
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


def delete_inspection(db: Session, inspection: Inspection, *, actor_user_id: int) -> None:
    """Hard-delete (admin only) — custody deductions are reversed first so stock stays true."""
    for line in inspection.items:
        if line.stock_movement_id is not None:
            stock_service.reverse_movement(
                db, original_id=line.stock_movement_id, actor_user_id=actor_user_id,
                movement_type="reverse_inspection_out",
            )
    audit_service.record(db, action="inspection.delete", actor_user_id=actor_user_id,
                         entity_type="inspection", entity_id=inspection.id,
                         before={"doc": inspection.document_number})
    db.delete(inspection)


def get_inspection(db: Session, inspection_id: int) -> Inspection | None:
    return db.scalar(
        select(Inspection).options(selectinload(Inspection.items))
        .where(Inspection.id == inspection_id)
    )
