"""Manufacturing router (T030). FR-013–016."""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_MANUFACTURE_WRITE
from src.core.db import get_db
from src.models.stock import LocationKind
from src.services import manufacturing_service
from src.services.manufacturing_service import ManufacturingError
from src.services.stock_service import StockError

router = APIRouter(tags=["manufacturing"], prefix="/manufacturing")


class LocationIn(BaseModel):
    location_kind: LocationKind
    location_id: int


class ManufactureOp(BaseModel):
    item_id: int
    location: LocationIn
    quantity: Decimal


class OpOut(BaseModel):
    id: int
    document_number: str
    op_type: str
    stock_movement_id: int


def _out(op) -> OpOut:
    return OpOut(id=op.id, document_number=op.document_number, op_type=op.op_type.value,
                 stock_movement_id=op.stock_movement_id)


@router.post("/consume", response_model=OpOut, status_code=status.HTTP_201_CREATED)
def consume(
    body: ManufactureOp,
    current: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_WRITE)),
    db: Session = Depends(get_db),
) -> OpOut:
    try:
        op = manufacturing_service.consume(
            db, item_id=body.item_id, location_kind=body.location.location_kind,
            location_id=body.location.location_id, quantity=body.quantity, actor_user_id=current.id)
    except (ManufacturingError, StockError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "manufacturing_invalid", "message": str(exc)})
    db.commit()
    return _out(op)


@router.post("/produce", response_model=OpOut, status_code=status.HTTP_201_CREATED)
def produce(
    body: ManufactureOp,
    current: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_WRITE)),
    db: Session = Depends(get_db),
) -> OpOut:
    try:
        op = manufacturing_service.produce(
            db, item_id=body.item_id, location_kind=body.location.location_kind,
            location_id=body.location.location_id, quantity=body.quantity, actor_user_id=current.id)
    except (ManufacturingError, StockError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "manufacturing_invalid", "message": str(exc)})
    db.commit()
    return _out(op)


@router.post("/{op_id}/reverse", response_model=OpOut, status_code=status.HTTP_201_CREATED)
def reverse(
    op_id: int,
    current: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_WRITE)),
    db: Session = Depends(get_db),
) -> OpOut:
    try:
        op = manufacturing_service.reverse_op(db, op_id=op_id, actor_user_id=current.id)
    except (ManufacturingError, StockError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "manufacturing_conflict", "message": str(exc)})
    db.commit()
    return _out(op)
