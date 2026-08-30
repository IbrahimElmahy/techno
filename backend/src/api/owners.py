"""Owners router (015-aftersales-owners) — الملّاك (أصحاب البيوت).

ملّاك المعاينات منفصلون عن العملاء الماليين؛ الشركة لا تبيع لهم ولا تحاسبهم.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, or_, select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_INSPECTION_READ, CAP_INSPECTION_WRITE
from src.core.db import get_db
from src.models.inspection import Inspection
from src.models.owner import Owner

router = APIRouter(tags=["owners"], prefix="/owners")


class OwnerIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    phone: str | None = Field(default=None, max_length=32)
    national_id: str | None = Field(default=None, max_length=32)
    address: str | None = Field(default=None, max_length=255)
    floor_number: str | None = Field(default=None, max_length=16)
    notes: str | None = Field(default=None, max_length=500)
    territory_id: int | None = None
    branch_id: int | None = None
    service_rep_id: int | None = None
    active: bool = True


class OwnerPatch(BaseModel):
    name: str | None = Field(default=None, max_length=160)
    phone: str | None = Field(default=None, max_length=32)
    national_id: str | None = Field(default=None, max_length=32)
    address: str | None = Field(default=None, max_length=255)
    floor_number: str | None = Field(default=None, max_length=16)
    notes: str | None = Field(default=None, max_length=500)
    territory_id: int | None = None
    branch_id: int | None = None
    service_rep_id: int | None = None
    active: bool | None = None


class OwnerListItem(BaseModel):
    id: int
    code: str | None
    name: str
    phone: str | None
    national_id: str | None
    address: str | None
    floor_number: str | None
    notes: str | None
    territory_id: int | None
    branch_id: int | None
    service_rep_id: int | None
    active: bool
    created_at: datetime
    inspection_count: int = 0
    last_inspection_date: date | None = None


class OwnerInspectionBrief(BaseModel):
    id: int
    document_number: str
    certificate_number: int | None
    inspection_date: date
    visit_type: str
    status: str
    printed: bool
    technician_name: str | None
    technician_phone: str | None
    purchase_shop: str | None
    total_points: Decimal


class OwnerDetail(OwnerListItem):
    inspections: list[OwnerInspectionBrief] = []


@router.get("", response_model=list[OwnerListItem])
def list_owners(
    search: str | None = Query(default=None),
    territory_id: int | None = Query(default=None),
    branch_id: int | None = Query(default=None),
    service_rep_id: int | None = Query(default=None),
    has_inspections: bool | None = Query(default=None),
    limit: int = Query(default=500, le=2000),
    offset: int = Query(default=0, ge=0),
    _: CurrentUser = Depends(require_capability(CAP_INSPECTION_READ)),
    db: Session = Depends(get_db),
) -> list[OwnerListItem]:
    # Aggregated query for inspection count and last inspection date
    insp_subq = (
        select(
            Inspection.owner_id.label("owner_id"),
            func.count(Inspection.id).label("insp_count"),
            func.max(Inspection.inspection_date).label("last_date"),
        )
        .where(Inspection.owner_id.is_not(None))
        .group_by(Inspection.owner_id)
        .subquery()
    )

    stmt = (
        select(
            Owner,
            func.coalesce(insp_subq.c.insp_count, 0).label("insp_count"),
            insp_subq.c.last_date,
        )
        .outerjoin(insp_subq, Owner.id == insp_subq.c.owner_id)
    )

    if search:
        q = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                Owner.name.ilike(q),
                Owner.phone.ilike(q),
                Owner.code.ilike(q),
                Owner.national_id.ilike(q),
                Owner.address.ilike(q),
            )
        )
    if territory_id is not None:
        stmt = stmt.where(Owner.territory_id == territory_id)
    if branch_id is not None:
        stmt = stmt.where(Owner.branch_id == branch_id)
    if service_rep_id is not None:
        stmt = stmt.where(Owner.service_rep_id == service_rep_id)
    if has_inspections is True:
        stmt = stmt.where(func.coalesce(insp_subq.c.insp_count, 0) > 0)
    elif has_inspections is False:
        stmt = stmt.where(func.coalesce(insp_subq.c.insp_count, 0) == 0)

    stmt = stmt.order_by(
        desc(func.coalesce(insp_subq.c.insp_count, 0)),
        desc(Owner.id),
    ).offset(offset).limit(limit)

    rows = db.execute(stmt).all()

    return [
        OwnerListItem(
            id=o.id,
            code=o.code,
            name=o.name,
            phone=o.phone,
            national_id=o.national_id,
            address=o.address,
            floor_number=o.floor_number,
            notes=o.notes,
            territory_id=o.territory_id,
            branch_id=o.branch_id,
            service_rep_id=o.service_rep_id,
            active=o.active,
            created_at=o.created_at,
            inspection_count=int(cnt),
            last_inspection_date=last_dt,
        )
        for o, cnt, last_dt in rows
    ]


@router.get("/{owner_id}", response_model=OwnerDetail)
def get_owner(
    owner_id: int,
    _: CurrentUser = Depends(require_capability(CAP_INSPECTION_READ)),
    db: Session = Depends(get_db),
) -> OwnerDetail:
    owner = db.get(Owner, owner_id)
    if owner is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, {"code": "not_found", "message": "Owner not found."})

    inspections = db.scalars(
        select(Inspection)
        .where(Inspection.owner_id == owner_id)
        .order_by(desc(Inspection.inspection_date), desc(Inspection.id))
    ).all()

    last_dt = inspections[0].inspection_date if inspections else None

    return OwnerDetail(
        id=owner.id,
        code=owner.code,
        name=owner.name,
        phone=owner.phone,
        national_id=owner.national_id,
        address=owner.address,
        floor_number=owner.floor_number,
        notes=owner.notes,
        territory_id=owner.territory_id,
        branch_id=owner.branch_id,
        service_rep_id=owner.service_rep_id,
        active=owner.active,
        created_at=owner.created_at,
        inspection_count=len(inspections),
        last_inspection_date=last_dt,
        inspections=[
            OwnerInspectionBrief(
                id=i.id,
                document_number=i.document_number,
                certificate_number=i.certificate_number,
                inspection_date=i.inspection_date,
                visit_type=i.visit_type,
                status=i.status.value if hasattr(i.status, "value") else str(i.status),
                printed=i.printed,
                technician_name=i.technician_name,
                technician_phone=i.technician_phone,
                purchase_shop=i.purchase_shop,
                total_points=i.total_points,
            )
            for i in inspections
        ],
    )


@router.post("", response_model=OwnerListItem, status_code=status.HTTP_201_CREATED)
def create_owner(
    body: OwnerIn,
    current: CurrentUser = Depends(require_capability(CAP_INSPECTION_WRITE)),
    db: Session = Depends(get_db),
) -> OwnerListItem:
    owner = Owner(
        name=body.name.strip(),
        phone=body.phone.strip() if body.phone else None,
        national_id=body.national_id.strip() if body.national_id else None,
        address=body.address.strip() if body.address else None,
        floor_number=body.floor_number.strip() if body.floor_number else None,
        notes=body.notes.strip() if body.notes else None,
        territory_id=body.territory_id,
        branch_id=body.branch_id,
        service_rep_id=body.service_rep_id,
        active=body.active,
    )
    db.add(owner)
    db.commit()
    db.refresh(owner)
    return OwnerListItem(
        id=owner.id,
        code=owner.code,
        name=owner.name,
        phone=owner.phone,
        national_id=owner.national_id,
        address=owner.address,
        floor_number=owner.floor_number,
        notes=owner.notes,
        territory_id=owner.territory_id,
        branch_id=owner.branch_id,
        service_rep_id=owner.service_rep_id,
        active=owner.active,
        created_at=owner.created_at,
        inspection_count=0,
        last_inspection_date=None,
    )


@router.patch("/{owner_id}", response_model=OwnerListItem)
def update_owner(
    owner_id: int,
    body: OwnerPatch,
    current: CurrentUser = Depends(require_capability(CAP_INSPECTION_WRITE)),
    db: Session = Depends(get_db),
) -> OwnerListItem:
    owner = db.get(Owner, owner_id)
    if owner is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, {"code": "not_found", "message": "Owner not found."})

    if body.name is not None:
        owner.name = body.name.strip()
    if body.phone is not None:
        owner.phone = body.phone.strip() or None
    if body.national_id is not None:
        owner.national_id = body.national_id.strip() or None
    if body.address is not None:
        owner.address = body.address.strip() or None
    if body.floor_number is not None:
        owner.floor_number = body.floor_number.strip() or None
    if body.notes is not None:
        owner.notes = body.notes.strip() or None
    if body.territory_id is not None:
        owner.territory_id = body.territory_id
    if body.branch_id is not None:
        owner.branch_id = body.branch_id
    if body.service_rep_id is not None:
        owner.service_rep_id = body.service_rep_id
    if body.active is not None:
        owner.active = body.active

    db.commit()
    db.refresh(owner)

    insp_count = db.scalar(select(func.count(Inspection.id)).where(Inspection.owner_id == owner_id)) or 0
    last_date = db.scalar(select(func.max(Inspection.inspection_date)).where(Inspection.owner_id == owner_id))

    return OwnerListItem(
        id=owner.id,
        code=owner.code,
        name=owner.name,
        phone=owner.phone,
        national_id=owner.national_id,
        address=owner.address,
        floor_number=owner.floor_number,
        notes=owner.notes,
        territory_id=owner.territory_id,
        branch_id=owner.branch_id,
        service_rep_id=owner.service_rep_id,
        active=owner.active,
        created_at=owner.created_at,
        inspection_count=insp_count,
        last_inspection_date=last_date,
    )
