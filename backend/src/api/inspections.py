"""Site inspections router (015-inspections-mobile) — معاينات.

Serves the rep mobile app: create/list/detail plus a batch `sync` endpoint that is idempotent by
device-generated `client_uuid` (safe to retry after a dropped connection). Sales reps are scoped to
their own inspections; managers see everything.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_INSPECTION_READ, CAP_INSPECTION_WRITE
from src.core.db import get_db
from src.models.inspection import VisitKind
from src.models.role import RoleName
from src.services import inspection_service
from src.services.inspection_service import InspectionError, LineIn

router = APIRouter(tags=["inspections"], prefix="/inspections")


class InspectionLineIn(BaseModel):
    item_id: int | None = None
    item_name: str = Field(min_length=1, max_length=160)
    quantity: Decimal
    points: Decimal = Decimal("0")


class InspectionIn(BaseModel):
    visit_kind: VisitKind = VisitKind.technician
    inspection_date: date
    owner_name: str = Field(min_length=1, max_length=160)
    owner_phone: str | None = None
    national_id: str | None = None
    owner_address: str | None = None
    floor_number: str | None = None
    description: str | None = None       # توصيف المعاينة (lookup)
    inspection_type: str | None = None   # نوع المعاينة (lookup)
    technician_name: str | None = None
    technician_phone: str | None = None
    purchase_shop: str | None = None
    visit_details: str | None = None
    client_uuid: str | None = Field(default=None, max_length=40)
    items: list[InspectionLineIn] = []


class InspectionLineOut(BaseModel):
    id: int
    item_id: int | None
    item_name: str
    quantity: Decimal
    points: Decimal
    total: Decimal


class InspectionOut(BaseModel):
    id: int
    document_number: str
    client_uuid: str | None
    visit_kind: VisitKind
    inspection_date: date
    owner_name: str
    owner_phone: str | None
    national_id: str | None
    owner_address: str | None
    floor_number: str | None
    description: str | None
    inspection_type: str | None
    technician_name: str | None
    technician_phone: str | None
    purchase_shop: str | None
    visit_details: str | None
    total_points: Decimal
    rep_user_id: int
    items: list[InspectionLineOut]


class SyncIn(BaseModel):
    inspections: list[InspectionIn]


class SyncResultOut(BaseModel):
    client_uuid: str | None
    id: int
    document_number: str


def _out(i) -> InspectionOut:
    return InspectionOut(
        id=i.id, document_number=i.document_number, client_uuid=i.client_uuid,
        visit_kind=i.visit_kind, inspection_date=i.inspection_date, owner_name=i.owner_name,
        owner_phone=i.owner_phone, national_id=i.national_id, owner_address=i.owner_address,
        floor_number=i.floor_number, description=i.description,
        inspection_type=i.inspection_type, technician_name=i.technician_name,
        technician_phone=i.technician_phone, purchase_shop=i.purchase_shop,
        visit_details=i.visit_details, total_points=i.total_points, rep_user_id=i.rep_user_id,
        items=[InspectionLineOut(id=ln.id, item_id=ln.item_id, item_name=ln.item_name,
                                 quantity=ln.quantity, points=ln.points, total=ln.total)
               for ln in i.items],
    )


def _create(db: Session, body: InspectionIn, current: CurrentUser):
    return inspection_service.create_inspection(
        db, visit_kind=body.visit_kind, inspection_date=body.inspection_date,
        owner_name=body.owner_name, rep_user_id=current.id, actor_user_id=current.id,
        owner_phone=body.owner_phone, national_id=body.national_id,
        owner_address=body.owner_address, floor_number=body.floor_number,
        description=body.description, inspection_type=body.inspection_type,
        technician_name=body.technician_name, technician_phone=body.technician_phone,
        purchase_shop=body.purchase_shop, visit_details=body.visit_details,
        client_uuid=body.client_uuid,
        lines=[LineIn(item_id=ln.item_id, item_name=ln.item_name,
                      quantity=ln.quantity, points=ln.points) for ln in body.items],
    )


@router.post("", response_model=InspectionOut, status_code=status.HTTP_201_CREATED)
def create_inspection(
    body: InspectionIn,
    current: CurrentUser = Depends(require_capability(CAP_INSPECTION_WRITE)),
    db: Session = Depends(get_db),
) -> InspectionOut:
    try:
        insp = _create(db, body, current)
    except InspectionError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "inspection_invalid", "message": str(exc)})
    db.commit()
    return _out(insp)


@router.post("/sync", response_model=list[SyncResultOut])
def sync_inspections(
    body: SyncIn,
    current: CurrentUser = Depends(require_capability(CAP_INSPECTION_WRITE)),
    db: Session = Depends(get_db),
) -> list[SyncResultOut]:
    """Batch upload from the mobile app. Idempotent by client_uuid — retries are no-ops."""
    results: list[SyncResultOut] = []
    for record in body.inspections:
        try:
            insp = _create(db, record, current)
        except InspectionError as exc:
            db.rollback()
            raise HTTPException(status.HTTP_409_CONFLICT,
                                {"code": "sync_failed", "message": str(exc),
                                 "client_uuid": record.client_uuid})
        results.append(SyncResultOut(client_uuid=insp.client_uuid, id=insp.id,
                                     document_number=insp.document_number))
    db.commit()
    return results


@router.get("", response_model=list[InspectionOut])
def list_inspections(
    visit_kind: VisitKind | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    rep_id: int | None = Query(default=None),
    current: CurrentUser = Depends(require_capability(CAP_INSPECTION_READ)),
    db: Session = Depends(get_db),
) -> list[InspectionOut]:
    # Reps only ever see their own inspections; managers may filter by rep.
    scope_rep = current.id if current.role == RoleName.sales_rep else rep_id
    rows = inspection_service.list_inspections(
        db, visit_kind=visit_kind, rep_user_id=scope_rep, date_from=date_from, date_to=date_to)
    return [_out(i) for i in rows]


@router.get("/{inspection_id}", response_model=InspectionOut)
def get_inspection(
    inspection_id: int,
    current: CurrentUser = Depends(require_capability(CAP_INSPECTION_READ)),
    db: Session = Depends(get_db),
) -> InspectionOut:
    insp = inspection_service.get_inspection(db, inspection_id)
    if insp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            {"code": "not_found", "message": "Inspection not found."})
    if current.role == RoleName.sales_rep and insp.rep_user_id != current.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            {"code": "forbidden", "message": "Not your inspection."})
    return _out(insp)
