from __future__ import annotations

import logging

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from src.lib.doc_order import newest_first
from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_TRANSFER_APPROVE, CAP_TRANSFER_INITIATE
from src.core.db import get_db
from src.core.money import to_qty
from src.models.stock import LocationKind
from src.models.transfer import StockTransfer, StockTransferLine, TransferRoute
from src.services import transfer_service
from src.services.stock_service import StockError
from src.services.batch_service import BatchError
from src.services.serial_service import SerialError
from src.services.transfer_service import TransferDenied, TransferError

from src.auth.rbac import role_has_capability
from src.models.role import RoleName
from src.models.transfer import StockTransfer, TransferStatus
from src.auth import branch_scope
log = logging.getLogger(__name__)

router = APIRouter(tags=["transfers"], prefix="/transfers")


class LocationIn(BaseModel):
    location_kind: LocationKind
    location_id: int


class TransferCreate(BaseModel):
    item_id: int
    quantity: Decimal
    route: TransferRoute
    source: LocationIn
    dest: LocationIn
    transfer_date: date | None = None
    lines: list["LineIn"] = []
    client_uuid: str | None = None
    statement1: str | None = Field(default=None, max_length=200)
    external_document_number: str | None = Field(default=None, max_length=40)
    notes: str | None = Field(default=None, max_length=500)


class TransferOut(BaseModel):
    id: int
    document_number: str
    status: str
    route: str
    approved_by: int | None = None
    item_id: int | None = None
    quantity: Decimal | None = None
    source_location_kind: str | None = None
    source_location_id: int | None = None
    dest_location_kind: str | None = None
    dest_location_id: int | None = None
    transfer_date: str | None = None
    created_at: str | None = None
    reject_reason: str | None = None
    statement1: str | None = None
    external_document_number: str | None = None
    notes: str | None = None
    lines: list["TransferLineOut"] = []


class TransferLineOut(BaseModel):
    id: int
    item_id: int
    quantity: Decimal


class LineIn(BaseModel):
    item_id: int
    quantity: Decimal


class LineQtyIn(BaseModel):
    quantity: Decimal


class TextsIn(BaseModel):
    statement1: str | None = Field(default=None, max_length=200)
    external_document_number: str | None = Field(default=None, max_length=40)
    notes: str | None = Field(default=None, max_length=500)


class RejectIn(BaseModel):
    reason: str | None = None


def _out(t) -> TransferOut:
    lines = list(getattr(t, "lines", []))
    head_item = lines[0].item_id if len(lines) == 1 else (None if lines else t.item_id)
    head_qty = (sum((ln.quantity for ln in lines), to_qty(0)) if lines else t.quantity)
    return TransferOut(
        id=t.id, document_number=t.document_number, status=t.status.value,
        route=t.route.value, approved_by=t.approved_by,
        item_id=head_item, quantity=head_qty,
        source_location_kind=t.source_location_kind.value,
        source_location_id=t.source_location_id,
        dest_location_kind=t.dest_location_kind.value,
        dest_location_id=t.dest_location_id,
        created_at=str(t.created_at) if t.created_at else None,
        transfer_date=str(t.transfer_date) if getattr(t, "transfer_date", None) else None,
        reject_reason=getattr(t, "reject_reason", None),
        statement1=getattr(t, "statement1", None),
        external_document_number=getattr(t, "external_document_number", None),
        notes=getattr(t, "notes", None),
        lines=[TransferLineOut(id=ln.id, item_id=ln.item_id, quantity=ln.quantity)
               for ln in getattr(t, "lines", [])],
    )


@router.get("", response_model=list[TransferOut])
def list_transfers(
    status_filter: str | None = None,
    item_id: int | None = None,
    limit: int | None = None,
    offset: int = 0,
    date_from: date | None = None,
    date_to: date | None = None,
    current: CurrentUser = Depends(require_capability(CAP_TRANSFER_INITIATE)),
    db: Session = Depends(get_db),
) -> list[TransferOut]:
    stmt = branch_scope.scope(select(StockTransfer), StockTransfer, current)
    if status_filter:
        stmt = stmt.where(StockTransfer.status == status_filter)
    if item_id is not None:
        stmt = stmt.where(StockTransfer.item_id == item_id)
    if date_from or date_to:
        from sqlalchemy import Date, cast, func

        day = func.coalesce(StockTransfer.transfer_date, cast(StockTransfer.created_at, Date))
        if date_from:
            stmt = stmt.where(day >= date_from)
        if date_to:
            stmt = stmt.where(day <= date_to)
    stmt = stmt.order_by(*newest_first(StockTransfer, StockTransfer.transfer_date)).options(
        selectinload(StockTransfer.lines))
    if limit is not None:
        stmt = stmt.limit(limit).offset(offset)
    return [_out(t) for t in db.scalars(stmt).all()]


@router.post("", response_model=TransferOut, status_code=status.HTTP_201_CREATED)
def create_transfer(
    body: TransferCreate,
    current: CurrentUser = Depends(require_capability(CAP_TRANSFER_INITIATE)),
    db: Session = Depends(get_db),
) -> TransferOut:
    if body.client_uuid:
        seen = db.scalar(select(StockTransfer)
                         .where(StockTransfer.client_uuid == body.client_uuid)
                         .options(selectinload(StockTransfer.lines)))
        if seen is not None:
            return _out(seen)
    try:
        t = transfer_service.initiate(
            db, item_id=body.item_id, quantity=body.quantity, route=body.route,
            source_kind=body.source.location_kind, source_id=body.source.location_id,
            dest_kind=body.dest.location_kind, dest_id=body.dest.location_id,
            initiated_by=current.id, transfer_date=body.transfer_date,
            client_uuid=body.client_uuid,
            statement1=body.statement1, notes=body.notes,
            external_document_number=body.external_document_number)
        for ln in body.lines:
            transfer_service.add_line(db, transfer_id=t.id, item_id=ln.item_id,
                                      quantity=ln.quantity, actor_user_id=current.id)
    except TransferError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            {"code": "transfer_invalid", "message": str(exc)})
    db.commit()
    db.refresh(t)
    return _out(t)


def _may_approve_now(db: Session, current: CurrentUser, t) -> bool:
    if not current.can(CAP_TRANSFER_APPROVE):
        return False
    src_branch = transfer_service._location_branch(
        db, t.source_location_kind, t.source_location_id)
    sees_all = branch_scope.sees_all_branches(current)
    if src_branch is None:
        return sees_all
    return sees_all or (current.role == RoleName.branch_manager
                        and current.branch_id == src_branch)


@router.post("/{transfer_id}/self-approve", response_model=TransferOut)
def self_approve(
    transfer_id: int,
    current: CurrentUser = Depends(require_capability(CAP_TRANSFER_INITIATE)),
    db: Session = Depends(get_db),
) -> TransferOut:
    t = db.get(StockTransfer, transfer_id)
    if t is None:
        raise HTTPException(404, {"code": "not_found", "message": "إذن التحويل مش موجود"})
    if t.status != TransferStatus.pending or not _may_approve_now(db, current, t):
        return _out(t)
    sees_all = branch_scope.sees_all_branches(current)
    try:
        t = transfer_service.approve(
            db, transfer_id=transfer_id, approver_role=current.role,
            approver_branch_id=current.branch_id, approver_user_id=current.id,
            is_admin=sees_all)
        db.commit()
    except (TransferDenied, TransferError, StockError, SerialError, BatchError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "transfer_conflict", "message": str(exc)})
    except Exception:  # noqa: BLE001
        db.rollback()
        log.exception("self-approve %s وقع — الإذن اتساب معلّق", transfer_id)
        t = db.get(StockTransfer, transfer_id)
    return _out(t)


@router.post("/{transfer_id}/approve", response_model=TransferOut)
def approve_transfer(
    transfer_id: int,
    current: CurrentUser = Depends(require_capability(CAP_TRANSFER_APPROVE)),
    db: Session = Depends(get_db),
) -> TransferOut:
    try:
        t = transfer_service.approve(
            db, transfer_id=transfer_id, approver_role=current.role,
            approver_branch_id=current.branch_id, approver_user_id=current.id,
            is_admin=branch_scope.sees_all_branches(current))
    except TransferDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, {"code": "forbidden", "message": str(exc)})
    except (TransferError, StockError, SerialError, BatchError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "transfer_conflict", "message": str(exc)})
    db.commit()
    return _out(t)


class CancelIn(BaseModel):
    reason: str | None = None


@router.post("/{transfer_id}/cancel", response_model=TransferOut)
def cancel_transfer(
    transfer_id: int,
    body: CancelIn,
    current: CurrentUser = Depends(require_capability(CAP_TRANSFER_APPROVE)),
    db: Session = Depends(get_db),
) -> TransferOut:
    try:
        t = transfer_service.cancel(
            db, transfer_id=transfer_id, actor_user_id=current.id, reason=body.reason)
    except (TransferError, StockError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "transfer_conflict", "message": str(exc)})
    db.commit()
    return _out(t)


@router.get("/{transfer_id}", response_model=TransferOut)
def get_transfer(
    transfer_id: int,
    current: CurrentUser = Depends(require_capability(CAP_TRANSFER_INITIATE)),
    db: Session = Depends(get_db),
) -> TransferOut:
    t = db.get(StockTransfer, transfer_id)
    if t is None or not branch_scope.may_see(current, t):
        raise HTTPException(404, {"code": "not_found", "message": "إذن التحويل مش موجود."})
    return _out(t)


@router.delete("/{transfer_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transfer(
    transfer_id: int,
    current: CurrentUser = Depends(require_capability(CAP_TRANSFER_APPROVE)),
    db: Session = Depends(get_db),
) -> None:
    try:
        transfer_service.delete(db, transfer_id=transfer_id, actor_user_id=current.id)
    except (TransferError, StockError) as exc:
        code = 404 if "مش موجود" in str(exc) else status.HTTP_409_CONFLICT
        raise HTTPException(code, {"code": "transfer_conflict", "message": str(exc)})
    db.commit()


@router.post("/{transfer_id}/reject", response_model=TransferOut)
def reject_transfer(
    transfer_id: int,
    body: RejectIn,
    current: CurrentUser = Depends(require_capability(CAP_TRANSFER_APPROVE)),
    db: Session = Depends(get_db),
) -> TransferOut:
    try:
        t = transfer_service.reject(
            db, transfer_id=transfer_id, actor_user_id=current.id, reason=body.reason)
    except TransferError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "transfer_conflict", "message": str(exc)})
    db.commit()
    return _out(t)


@router.patch("/{transfer_id}", response_model=TransferOut)
def update_transfer_texts(
    transfer_id: int,
    body: TextsIn,
    current: CurrentUser = Depends(require_capability(CAP_TRANSFER_INITIATE)),
    db: Session = Depends(get_db),
) -> TransferOut:
    t = db.get(StockTransfer, transfer_id)
    if t is None or not branch_scope.may_see(current, t):
        raise HTTPException(404, {"code": "not_found", "message": "إذن التحويل مش موجود."})
    try:
        transfer_service.set_texts(
            db, transfer_id=transfer_id, values=body.model_dump(exclude_unset=True),
            actor_user_id=current.id)
    except TransferError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "transfer_conflict", "message": str(exc)})
    db.commit()
    return _out(db.get(StockTransfer, transfer_id))


@router.post("/{transfer_id}/lines", response_model=TransferOut,
             status_code=status.HTTP_201_CREATED)
def add_transfer_line(
    transfer_id: int,
    body: LineIn,
    current: CurrentUser = Depends(require_capability(CAP_TRANSFER_INITIATE)),
    db: Session = Depends(get_db),
) -> TransferOut:
    try:
        transfer_service.add_line(
            db, transfer_id=transfer_id, item_id=body.item_id, quantity=body.quantity,
            actor_user_id=current.id)
    except TransferError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "transfer_conflict", "message": str(exc)})
    db.commit()
    return _out(db.get(StockTransfer, transfer_id))


@router.patch("/lines/{line_id}", response_model=TransferOut)
def set_transfer_line_quantity(
    line_id: int,
    body: LineQtyIn,
    current: CurrentUser = Depends(require_capability(CAP_TRANSFER_APPROVE)),
    db: Session = Depends(get_db),
) -> TransferOut:
    try:
        line = transfer_service.set_line_quantity(
            db, line_id=line_id, quantity=body.quantity, actor_user_id=current.id)
        transfer_id = line.transfer_id
    except TransferError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "transfer_conflict", "message": str(exc)})
    db.commit()
    return _out(db.get(StockTransfer, transfer_id))


@router.delete("/lines/{line_id}", response_model=TransferOut)
def remove_transfer_line(
    line_id: int,
    current: CurrentUser = Depends(require_capability(CAP_TRANSFER_APPROVE)),
    db: Session = Depends(get_db),
) -> TransferOut:
    line = db.get(StockTransferLine, line_id)
    transfer_id = line.transfer_id if line else None
    try:
        transfer_service.remove_line(db, line_id=line_id, actor_user_id=current.id)
    except TransferError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "transfer_conflict", "message": str(exc)})
    db.commit()
    return _out(db.get(StockTransfer, transfer_id))
