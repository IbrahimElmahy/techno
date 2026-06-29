"""Stock router (T018): derived on-hand. FR-007."""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_STOCK_READ
from src.core.db import get_db
from src.models.stock import LocationKind
from src.models.warehouse import Custody
from src.services.stock_service import on_hand

router = APIRouter(tags=["stock"], prefix="/stock")


class OnHandOut(BaseModel):
    item_id: int
    location_kind: LocationKind
    location_id: int
    on_hand: Decimal
    derived: bool = True


@router.get("/on-hand", response_model=OnHandOut)
def get_on_hand(
    item_id: int,
    location_kind: LocationKind,
    location_id: int,
    current: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
) -> OnHandOut:
    # A Sales Rep may only read their own custody's on-hand.
    if current.rep_id is not None:
        own = db.scalar(select(Custody).where(Custody.rep_id == current.rep_id))
        if location_kind != LocationKind.custody or own is None or own.id != location_id:
            raise HTTPException(403, {"code": "forbidden", "message": "Not your stock location"})
    return OnHandOut(
        item_id=item_id, location_kind=location_kind, location_id=location_id,
        on_hand=on_hand(db, item_id, location_kind, location_id),
    )
