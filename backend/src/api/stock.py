"""Stock router (T018): derived on-hand. FR-007. Reorder + expiring reports (011)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_STOCK_READ
from src.core.db import get_db
from src.models.stock import LocationKind
from src.models.warehouse import Custody
from src.services import stock_report
from src.services.batch_service import expiring
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


class ReorderRowOut(BaseModel):
    item_id: int
    code: str
    name: str
    on_hand: Decimal
    min_stock: Decimal | None
    max_stock: Decimal | None
    flag: str  # below_min | above_max


@router.get("/reorder", response_model=list[ReorderRowOut])
def get_reorder(
    _: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
) -> list[ReorderRowOut]:
    """Items below min_stock or above max_stock (advisory) — 011 FR-002/003."""
    return [
        ReorderRowOut(
            item_id=r.item_id, code=r.code, name=r.name, on_hand=r.on_hand,
            min_stock=r.min_stock, max_stock=r.max_stock, flag=r.flag,
        )
        for r in stock_report.reorder(db)
    ]


class ExpiringRowOut(BaseModel):
    id: int
    item_id: int
    location_kind: str
    location_id: int
    expiry_date: date
    quantity: Decimal


@router.get("/expiring", response_model=list[ExpiringRowOut])
def get_expiring(
    before: date = Query(...),
    item_id: int | None = None,
    _: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
) -> list[ExpiringRowOut]:
    """Batches expiring on/before `before` with remaining quantity — 011 FR-008."""
    return [
        ExpiringRowOut(
            id=b.id, item_id=b.item_id, location_kind=b.location_kind.value,
            location_id=b.location_id, expiry_date=b.expiry_date, quantity=b.quantity,
        )
        for b in expiring(db, before=before, item_id=item_id)
    ]
