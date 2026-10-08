from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from sqlalchemy.orm import selectinload

from src.services import numbering

from src.core.money import to_qty
from src.models.catalog import Item
from src.models.inspection import Inspection, InspectionItem, InspectionStatus, VisitKind
from src.models.stock import LocationKind, StockDirection, StockMovement
from src.models.warehouse import Custody
from src.services import audit_service, stock_service
from src.auth.branch_scope import branch_for

_log = logging.getLogger("uvicorn.error")


class InspectionError(Exception):
    pass


def rep_custody(db: Session, rep_user_id: int) -> Custody | None:
    return db.scalar(select(Custody).where(
        Custody.rep_id == rep_user_id, Custody.active.is_(True)))


def rep_stock_location(db: Session, rep_user_id: int) -> tuple[LocationKind, int] | None:
    custody = rep_custody(db, rep_user_id)
    if custody is None:
        return None
    if custody.warehouse_id is not None:
        return (LocationKind.warehouse, custody.warehouse_id)
    return (LocationKind.custody, custody.id)


def location_holdings(
    db: Session, location_kind: LocationKind, location_id: int
) -> dict[int, Decimal]:
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
    return numbering.next_document_number(db, Inspection, "INSP")


CERTIFICATE_SEQUENCE_FLOOR = 156204


def _next_certificate_number(db: Session) -> int:
    current = db.scalar(select(func.max(Inspection.certificate_number)))
    return max(current or 0, CERTIFICATE_SEQUENCE_FLOOR) + 1


def _points(value) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.001"))


def seed_item_types(db: Session) -> int:
    from src.data.inspection_item_seed import INSPECTION_ITEM_TYPES
    from src.models.inspection_item_type import InspectionItemType

    already = db.scalar(select(func.count()).select_from(InspectionItemType)) or 0
    if already:
        return 0
    for order, (name, points) in enumerate(INSPECTION_ITEM_TYPES):
        db.add(InspectionItemType(name=name, points=Decimal(points),
                                  sort_order=order, active=True))
    db.flush()
    return len(INSPECTION_ITEM_TYPES)


def list_item_types(db: Session, *, include_inactive: bool = False):
    from src.models.inspection_item_type import InspectionItemType

    seed_item_types(db)
    stmt = select(InspectionItemType)
    if not include_inactive:
        stmt = stmt.where(InspectionItemType.active.is_(True))
    return db.scalars(
        stmt.order_by(InspectionItemType.sort_order, InspectionItemType.id)
    ).all()


def create_item_type(db: Session, *, name: str, points, actor_user_id: int,
                     sort_order: int | None = None):
    from src.models.inspection_item_type import InspectionItemType

    seed_item_types(db)
    clean = " ".join((name or "").split())
    if not clean:
        raise InspectionError("اسم الصنف مطلوب.")
    if Decimal(str(points)) < 0:
        raise InspectionError("يجب أن تكون النقاط صفراً أو أكثر.")
    if db.scalar(select(InspectionItemType).where(InspectionItemType.name == clean)):
        raise InspectionError("يوجد صنف بنفس الاسم.")
    if sort_order is None:
        sort_order = (db.scalar(select(func.max(InspectionItemType.sort_order))) or 0) + 1
    t = InspectionItemType(name=clean, points=Decimal(str(points)), sort_order=sort_order,
                           active=True)
    db.add(t)
    db.flush()
    audit_service.record(db, action="inspection_item_type.create", actor_user_id=actor_user_id,
                         entity_type="inspection_item_type", entity_id=t.id,
                         after={"name": clean, "points": str(points)})
    return t


def update_item_type(db: Session, *, item_type_id: int, actor_user_id: int,
                     name: str | None = None, points=None, active: bool | None = None,
                     sort_order: int | None = None):
    from src.models.inspection_item_type import InspectionItemType

    t = db.get(InspectionItemType, item_type_id)
    if t is None:
        raise InspectionError("الصنف غير موجود.")
    if name is not None:
        clean = " ".join(name.split())
        if not clean:
            raise InspectionError("اسم الصنف مطلوب.")
        dup = db.scalar(select(InspectionItemType).where(
            InspectionItemType.name == clean, InspectionItemType.id != item_type_id))
        if dup is not None:
            raise InspectionError("يوجد صنف بنفس الاسم.")
        t.name = clean
    if points is not None:
        if Decimal(str(points)) < 0:
            raise InspectionError("يجب أن تكون النقاط صفراً أو أكثر.")
        t.points = Decimal(str(points))
    if active is not None:
        t.active = active
    if sort_order is not None:
        t.sort_order = sort_order
    db.flush()
    audit_service.record(db, action="inspection_item_type.update", actor_user_id=actor_user_id,
                         entity_type="inspection_item_type", entity_id=t.id,
                         after={"name": t.name, "points": str(t.points), "active": t.active})
    return t


def deactivate_item_type(db: Session, *, item_type_id: int, actor_user_id: int):
    return update_item_type(db, item_type_id=item_type_id, actor_user_id=actor_user_id,
                            active=False)


def create_inspection(
    db: Session, *, visit_kind: VisitKind, inspection_date: date, owner_name: str | None,
    rep_user_id: int, actor_user_id: int, lines: list[LineIn],
    owner_phone: str | None = None, national_id: str | None = None,
    owner_address: str | None = None, floor_number: str | None = None,
    description: str | None = None, inspection_type: str | None = None,
    visit_type: str | None = None,
    technician_name: str | None = None, technician_phone: str | None = None,
    purchase_shop: str | None = None, purchase_shop_phone: str | None = None,
    visit_details: str | None = None,
    customer_id: int | None = None, owner_id: int | None = None, client_uuid: str | None = None,
    merchant_customer_id: int | None = None,
) -> Inspection:
    name = (owner_name or "").strip()
    if customer_id is not None:
        from src.models.customer import Customer

        customer = db.get(Customer, customer_id)
        if customer is None:
            raise InspectionError("العميل غير موجود.")
        if not name:
            name = customer.name
    elif owner_id is not None:
        from src.models.owner import Owner

        owner = db.get(Owner, owner_id)
        if owner is None:
            owner_id = None
        elif not name:
            name = owner.name
    if not name:
        raise InspectionError("اسم صاحب الزيارة (أو العميل) مطلوب.")

    if client_uuid:
        existing = db.scalar(select(Inspection).where(Inspection.client_uuid == client_uuid))
        if existing is not None:
            return existing

    insp = Inspection(
        document_number=_doc_number(db), certificate_number=_next_certificate_number(db),
        client_uuid=client_uuid, visit_kind=visit_kind, customer_id=customer_id,
        owner_id=owner_id,
        inspection_date=inspection_date, owner_name=name, owner_phone=owner_phone,
        national_id=national_id, owner_address=owner_address, floor_number=floor_number,
        description=description, inspection_type=inspection_type,
        visit_type=(visit_type or "معاينة"),
        technician_name=technician_name, technician_phone=technician_phone,
        purchase_shop=purchase_shop, purchase_shop_phone=purchase_shop_phone,
        merchant_customer_id=merchant_customer_id,
        visit_details=visit_details,
        total_points=_points(0), rep_user_id=rep_user_id,
        branch_id=branch_for(db, actor_user_id=actor_user_id,
                             location_kind="rep", location_id=rep_user_id),
    )
    db.add(insp)
    db.flush()

    stock_loc = rep_stock_location(db, rep_user_id)

    total = Decimal("0")
    for ln in lines:
        qty = to_qty(ln.quantity)
        if qty <= 0:
            raise InspectionError("يجب أن تكون كمية السطر أكبر من صفر.")
        name = ln.item_name
        if ln.item_id is not None:
            item = db.get(Item, ln.item_id)
            if item is not None:
                name = item.name
        unit_points = Decimal(str(ln.points))
        line_total = _points(unit_points * qty)
        line = InspectionItem(
            inspection_id=insp.id, item_id=ln.item_id, item_name=name, quantity=qty,
            points=_points(unit_points), total=line_total,
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
    sync_inspection_points(db, insp, actor_user_id=actor_user_id)
    audit_service.record(db, action="inspection.create", actor_user_id=actor_user_id,
                         entity_type="inspection", entity_id=insp.id,
                         after={"doc": insp.document_number, "points": str(insp.total_points)})
    return insp


def _build_inspection_stmt(
    *, visit_kind: VisitKind | None = None, rep_user_id: int | None = None,
    date_from: date | None = None, date_to: date | None = None,
    status: InspectionStatus | None = None, visit_type: str | None = None,
    printed: bool | None = None, certificate_number: int | None = None,
    owner: str | None = None, technician: str | None = None, trader: str | None = None,
    q: str | None = None, branch_id: int | None = None,
):
    from sqlalchemy import or_ as _or
    from src.models.customer import Customer
    stmt = select(Inspection)
    joined_customer = False

    if branch_id is not None:
        stmt = stmt.where(_or(Inspection.branch_id == branch_id,
                              Inspection.branch_id.is_(None)))

    if visit_kind is not None:
        stmt = stmt.where(Inspection.visit_kind == visit_kind)
    if rep_user_id is not None:
        stmt = stmt.where(Inspection.rep_user_id == rep_user_id)
    if date_from is not None:
        stmt = stmt.where(Inspection.inspection_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(Inspection.inspection_date <= date_to)
    if status is not None:
        stmt = stmt.where(Inspection.status == status)
    if visit_type is not None:
        stmt = stmt.where(Inspection.visit_type == visit_type)
    if printed is not None:
        stmt = stmt.where(Inspection.printed.is_(printed))
    if certificate_number is not None:
        stmt = stmt.where(Inspection.certificate_number == certificate_number)
    if owner:
        stmt = stmt.where(Inspection.owner_name.contains(owner.strip()))
    if technician:
        stmt = stmt.where(Inspection.technician_name.contains(technician.strip()))
    if trader:
        if not joined_customer:
            stmt = stmt.outerjoin(Customer, Inspection.merchant_customer_id == Customer.id)
            joined_customer = True
        stmt = stmt.where(
            Inspection.purchase_shop.contains(trader.strip()) | Customer.name.contains(trader.strip())
        )
    if q:
        q_str = q.strip()
        if not joined_customer:
            stmt = stmt.outerjoin(Customer, Inspection.merchant_customer_id == Customer.id)
            joined_customer = True
        conds = [
            Inspection.document_number.contains(q_str),
            Inspection.owner_name.contains(q_str),
            Inspection.technician_name.contains(q_str),
            Inspection.purchase_shop.contains(q_str),
            Customer.name.contains(q_str),
        ]
        if q_str.isdigit():
            conds.append(Inspection.certificate_number == int(q_str))
        from sqlalchemy import or_
        stmt = stmt.where(or_(*conds))

    return stmt


def list_inspections(
    db: Session, *, visit_kind: VisitKind | None = None, rep_user_id: int | None = None,
    date_from: date | None = None, date_to: date | None = None,
    status: InspectionStatus | None = None, visit_type: str | None = None,
    printed: bool | None = None, certificate_number: int | None = None,
    owner: str | None = None, technician: str | None = None, trader: str | None = None,
    q: str | None = None, branch_id: int | None = None,
    limit: int | None = None, offset: int = 0,
) -> tuple[list[Inspection], int]:
    stmt = _build_inspection_stmt(
        visit_kind=visit_kind, rep_user_id=rep_user_id, date_from=date_from, date_to=date_to,
        status=status, visit_type=visit_type, printed=printed,
        certificate_number=certificate_number, owner=owner, technician=technician,
        trader=trader, q=q, branch_id=branch_id,
    )
    total_count = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0

    query = stmt.options(selectinload(Inspection.items)).order_by(
        Inspection.inspection_date.desc(), Inspection.id.desc()
    )
    if limit is not None:
        query = query.limit(min(limit, 500)).offset(offset)

    rows = list(db.scalars(query).all())
    return rows, total_count


def inspections_summary(
    db: Session, *, visit_kind: VisitKind | None = None, rep_user_id: int | None = None,
    date_from: date | None = None, date_to: date | None = None,
    status: InspectionStatus | None = None, visit_type: str | None = None,
    printed: bool | None = None, certificate_number: int | None = None,
    owner: str | None = None, technician: str | None = None, trader: str | None = None,
    q: str | None = None, branch_id: int | None = None,
) -> dict:
    from sqlalchemy import case
    base_stmt = _build_inspection_stmt(
        visit_kind=visit_kind, rep_user_id=rep_user_id, date_from=date_from, date_to=date_to,
        status=status, visit_type=visit_type, printed=printed,
        certificate_number=certificate_number, owner=owner, technician=technician,
        trader=trader, q=q, branch_id=branch_id,
    )
    subq = base_stmt.order_by(None).subquery()
    summary_stmt = select(
        func.count(subq.c.id).label("total_count"),
        func.coalesce(func.sum(case((subq.c.status == InspectionStatus.accepted.value, 1), else_=0)), 0).label("accepted_count"),
        func.coalesce(func.sum(case((subq.c.status == InspectionStatus.rejected.value, 1), else_=0)), 0).label("rejected_count"),
        func.coalesce(func.sum(case((subq.c.status == InspectionStatus.accepted.value, subq.c.total_points), else_=0)), Decimal("0.000")).label("accepted_points"),
    )
    row = db.execute(summary_stmt).one()
    return {
        "total_count": int(row.total_count or 0),
        "accepted_count": int(row.accepted_count or 0),
        "rejected_count": int(row.rejected_count or 0),
        "accepted_points": Decimal(str(row.accepted_points or 0)),
    }


def _inspection_point_record(db: Session, inspection_id: int, kind):
    from src.models.loyalty import PointRecord

    return db.scalar(select(PointRecord).where(
        PointRecord.inspection_id == inspection_id, PointRecord.kind == kind))


def _has_live_deduction(db: Session, inspection_id: int) -> bool:
    from src.models.loyalty import PointKind, PointRecord

    def _count(kind) -> int:
        return db.scalar(select(func.count(PointRecord.id)).where(
            PointRecord.inspection_id == inspection_id, PointRecord.kind == kind)) or 0

    return _count(PointKind.inspection) > _count(PointKind.inspection_reverse)


def sync_inspection_points(db: Session, inspection: Inspection, *, actor_user_id: int | None = None):
    from src.models.loyalty import PointKind
    from src.services import points_service

    total = _points(inspection.total_points or 0)
    if total <= 0:
        return None
    if inspection.merchant_customer_id is None:
        _log.warning(
            "inspection %s (%s) بـ%s نقطة بلا تاجر مرتبط — لا خصم للنقاط.",
            inspection.id, inspection.document_number, total)
        return None
    if _has_live_deduction(db, inspection.id):
        return None
    return points_service.post(
        db, customer_id=inspection.merchant_customer_id, kind=PointKind.inspection,
        delta=-total, inspection_id=inspection.id, actor_user_id=actor_user_id)


def _reverse_inspection_points(db: Session, inspection: Inspection, *, actor_user_id: int | None):
    from src.models.loyalty import PointKind, PointRecord

    from src.services import points_service

    if not _has_live_deduction(db, inspection.id):
        return None
    original = db.scalar(
        select(PointRecord)
        .where(PointRecord.inspection_id == inspection.id,
               PointRecord.kind == PointKind.inspection)
        .order_by(PointRecord.id.desc()))
    if original is None:
        return None
    return points_service.post(
        db, customer_id=original.customer_id, kind=PointKind.inspection_reverse,
        delta=-_points(original.delta), inspection_id=inspection.id,
        actor_user_id=actor_user_id)


def _delete_inspection_points(db: Session, inspection: Inspection) -> None:
    from src.models.loyalty import PointRecord

    for record in db.scalars(select(PointRecord).where(
            PointRecord.inspection_id == inspection.id)).all():
        db.delete(record)
    db.flush()


def _return_stock(db: Session, inspection: Inspection, *, actor_user_id: int) -> None:
    for line in inspection.items:
        if line.stock_movement_id is not None:
            stock_service.reverse_movement(
                db, original_id=line.stock_movement_id, actor_user_id=actor_user_id,
                movement_type="reverse_inspection_out",
            )


def reject_inspection(db: Session, inspection: Inspection, *, actor_user_id: int) -> Inspection:
    if inspection.status == InspectionStatus.rejected:
        raise InspectionError("المعاينة مرفوضة بالفعل.")
    _return_stock(db, inspection, actor_user_id=actor_user_id)
    _reverse_inspection_points(db, inspection, actor_user_id=actor_user_id)
    inspection.status = InspectionStatus.rejected
    db.flush()
    audit_service.record(db, action="inspection.reject", actor_user_id=actor_user_id,
                         entity_type="inspection", entity_id=inspection.id,
                         after={"doc": inspection.document_number})
    return inspection


def _deduct_stock_again(db: Session, inspection: Inspection, *, actor_user_id: int) -> None:
    stock_loc = rep_stock_location(db, inspection.rep_user_id)
    if stock_loc is None:
        return
    for line in inspection.items:
        if line.stock_movement_id is None or line.item_id is None:
            continue
        try:
            mv = stock_service.post_movement(
                db, item_id=line.item_id, location_kind=stock_loc[0],
                location_id=stock_loc[1], movement_type="inspection_out",
                direction=StockDirection.out, quantity=to_qty(line.quantity),
                actor_user_id=actor_user_id,
                source_doc_type="inspection", source_doc_id=inspection.id,
            )
        except stock_service.StockError as exc:
            raise InspectionError(
                f"الرصيد غير كافٍ في العهدة للصنف «{line.item_name}» — يتطلب القبول "
                f"خصم {to_qty(line.quantity)} مرة أخرى."
            ) from exc
        line.stock_movement_id = mv.id


def accept_inspection(db: Session, inspection: Inspection, *, actor_user_id: int) -> Inspection:
    if inspection.status == InspectionStatus.accepted:
        raise InspectionError("المعاينة مقبولة بالفعل.")
    _deduct_stock_again(db, inspection, actor_user_id=actor_user_id)
    inspection.status = InspectionStatus.accepted
    db.flush()
    sync_inspection_points(db, inspection, actor_user_id=actor_user_id)
    audit_service.record(db, action="inspection.accept", actor_user_id=actor_user_id,
                         entity_type="inspection", entity_id=inspection.id,
                         after={"doc": inspection.document_number})
    return inspection


def delete_inspection(db: Session, inspection: Inspection, *, actor_user_id: int) -> None:
    if inspection.status != InspectionStatus.rejected:
        _return_stock(db, inspection, actor_user_id=actor_user_id)
    _delete_inspection_points(db, inspection)
    audit_service.record(db, action="inspection.delete", actor_user_id=actor_user_id,
                         entity_type="inspection", entity_id=inspection.id,
                         before={"doc": inspection.document_number})
    db.delete(inspection)


def get_inspection(db: Session, inspection_id: int) -> Inspection | None:
    return db.scalar(
        select(Inspection).options(selectinload(Inspection.items))
        .where(Inspection.id == inspection_id)
    )
