"""Wastage / scrap documents router (014-production-reporting)."""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_MANUFACTURE_READ, CAP_MANUFACTURE_WRITE
from src.core.db import get_db
from src.services import wastage_service
from src.services.stock_service import StockError
from src.services.wastage_service import WastageError

router = APIRouter(tags=["wastage"], prefix="/wastage")


class WastageIn(BaseModel):
    item_id: int
    warehouse_id: int
    quantity: Decimal
    reason: str | None = None


class WastageOut(BaseModel):
    id: int
    document_number: str
    item_id: int
    warehouse_id: int
    quantity: Decimal
    unit_cost: Decimal
    total_cost: Decimal
    reason: str | None
    is_reversal: bool


def _out(d) -> WastageOut:
    return WastageOut(
        id=d.id, document_number=d.document_number, item_id=d.item_id,
        warehouse_id=d.warehouse_id, quantity=d.quantity, unit_cost=d.unit_cost,
        total_cost=d.total_cost, reason=d.reason, is_reversal=d.reverses_id is not None,
    )


@router.get("", response_model=list[WastageOut])
def list_wastage(
    _: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_READ)),
    db: Session = Depends(get_db),
) -> list[WastageOut]:
    return [_out(d) for d in wastage_service.list_wastage(db)]


@router.post("", response_model=WastageOut, status_code=status.HTTP_201_CREATED)
def create_wastage(
    body: WastageIn,
    current: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_WRITE)),
    db: Session = Depends(get_db),
) -> WastageOut:
    try:
        doc = wastage_service.create_wastage(
            db, item_id=body.item_id, warehouse_id=body.warehouse_id, quantity=body.quantity,
            reason=body.reason, actor_user_id=current.id)
    except (WastageError, StockError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "wastage_invalid", "message": str(exc)})
    db.commit()
    return _out(doc)


@router.post("/{wastage_id}/reverse", response_model=WastageOut,
             status_code=status.HTTP_201_CREATED)
def reverse_wastage(
    wastage_id: int,
    current: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_WRITE)),
    db: Session = Depends(get_db),
) -> WastageOut:
    try:
        doc = wastage_service.reverse_wastage(db, wastage_id=wastage_id, actor_user_id=current.id)
    except (WastageError, StockError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "wastage_conflict", "message": str(exc)})
    db.commit()
    return _out(doc)
