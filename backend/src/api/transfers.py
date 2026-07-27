"""Transfers router (T042). FR-022–024, FR-027."""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_TRANSFER_APPROVE, CAP_TRANSFER_INITIATE
from src.core.db import get_db
from src.models.stock import LocationKind
from src.models.transfer import StockTransfer, TransferRoute
from src.services import transfer_service
from src.services.stock_service import StockError
from src.services.transfer_service import TransferDenied, TransferError

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


class TransferOut(BaseModel):
    id: int
    document_number: str
    status: str
    route: str
    approved_by: int | None = None
    # What actually moved, so the list reads without a lookup per row.
    item_id: int | None = None
    quantity: Decimal | None = None
    source_location_kind: str | None = None
    source_location_id: int | None = None
    dest_location_kind: str | None = None
    dest_location_id: int | None = None
    created_at: str | None = None


def _out(t) -> TransferOut:
    return TransferOut(
        id=t.id, document_number=t.document_number, status=t.status.value,
        route=t.route.value, approved_by=t.approved_by,
        item_id=t.item_id, quantity=t.quantity,
        source_location_kind=t.source_location_kind.value,
        source_location_id=t.source_location_id,
        dest_location_kind=t.dest_location_kind.value,
        dest_location_id=t.dest_location_id,
        created_at=str(t.created_at) if t.created_at else None,
    )


@router.get("", response_model=list[TransferOut])
def list_transfers(
    status_filter: str | None = None,   # pending | approved | rejected | reversed
    item_id: int | None = None,
    _: CurrentUser = Depends(require_capability(CAP_TRANSFER_INITIATE)),
    db: Session = Depends(get_db),
) -> list[TransferOut]:
    """Transfer documents, newest first, optionally narrowed by status or item."""
    stmt = select(StockTransfer)
    if status_filter:
        stmt = stmt.where(StockTransfer.status == status_filter)
    if item_id is not None:
        stmt = stmt.where(StockTransfer.item_id == item_id)
    return [_out(t) for t in db.scalars(stmt.order_by(StockTransfer.id.desc())).all()]


@router.post("", response_model=TransferOut, status_code=status.HTTP_201_CREATED)
def create_transfer(
    body: TransferCreate,
    current: CurrentUser = Depends(require_capability(CAP_TRANSFER_INITIATE)),
    db: Session = Depends(get_db),
) -> TransferOut:
    try:
        t = transfer_service.initiate(
            db, item_id=body.item_id, quantity=body.quantity, route=body.route,
            source_kind=body.source.location_kind, source_id=body.source.location_id,
            dest_kind=body.dest.location_kind, dest_id=body.dest.location_id,
            initiated_by=current.id)
    except TransferError as exc:
        # Covers an illegal route, a non-positive quantity, same source/destination, and asking
        # for more than the source holds.
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            {"code": "transfer_invalid", "message": str(exc)})
    db.commit()
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
            is_admin=current.is_admin)
    except TransferDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, {"code": "forbidden", "message": str(exc)})
    except (TransferError, StockError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "transfer_conflict", "message": str(exc)})
    db.commit()
    return _out(t)


@router.post("/{transfer_id}/reverse", response_model=TransferOut, status_code=status.HTTP_201_CREATED)
def reverse_transfer(
    transfer_id: int,
    current: CurrentUser = Depends(require_capability(CAP_TRANSFER_APPROVE)),
    db: Session = Depends(get_db),
) -> TransferOut:
    try:
        t = transfer_service.reverse(db, transfer_id=transfer_id, actor_user_id=current.id)
    except (TransferError, StockError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "transfer_conflict", "message": str(exc)})
    db.commit()
    return _out(t)
