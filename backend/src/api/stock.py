"""Stock router (T018): derived on-hand. FR-007."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_PURCHASE_WRITE, CAP_STOCK_READ
from src.core.db import get_db
from src.models.catalog import Item
from src.models.stock import LocationKind, StockDirection, StockMovement
from src.models.warehouse import Custody
from src.services import batch_service
from src.services.stock_service import StockError, on_hand

router = APIRouter(tags=["stock"], prefix="/stock")


class OnHandOut(BaseModel):
    item_id: int
    location_kind: LocationKind
    location_id: int
    on_hand: Decimal
    derived: bool = True


class LocationStockRow(BaseModel):
    """One item held at a location, with the quantity actually available there."""

    item_id: int
    code: str | None = None
    name: str
    category: str | None = None
    unit_of_measure: str | None = None
    on_hand: Decimal


def _assert_readable(db: Session, current: CurrentUser, kind: LocationKind, location_id: int) -> None:
    """A Sales Rep may only read their OWN custody's stock."""
    if current.rep_id is None:
        return
    own = db.scalar(select(Custody).where(Custody.rep_id == current.rep_id))
    if kind != LocationKind.custody or own is None or own.id != location_id:
        raise HTTPException(403, {"code": "forbidden", "message": "Not your stock location"})


class BatchReceiveIn(BaseModel):
    item_id: int
    location_kind: LocationKind
    location_id: int
    expiry_date: date
    quantity: Decimal


@router.post("/batches", response_model=dict, status_code=201)
def receive_batch(
    body: BatchReceiveIn,
    current: CurrentUser = Depends(require_capability(CAP_PURCHASE_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    """Take a lot of a perishable item into stock with its expiry date (011)."""
    try:
        batch = batch_service.receive(
            db, item_id=body.item_id, location_kind=body.location_kind,
            location_id=body.location_id, expiry_date=body.expiry_date,
            quantity=body.quantity, actor_user_id=current.id,
        )
    except batch_service.BatchError as exc:
        raise HTTPException(422, {"code": "batch_invalid", "message": str(exc)}) from exc
    except StockError as exc:
        raise HTTPException(409, {"code": "no_negative_stock", "message": str(exc)}) from exc
    db.commit()
    return {"id": batch.id, "item_id": batch.item_id,
            "expiry_date": str(batch.expiry_date), "quantity": str(batch.quantity)}


@router.get("/batches/expiring", response_model=list[dict])
def expiring_batches(
    before: date,
    item_id: int | None = None,
    location_kind: LocationKind | None = None,
    location_id: int | None = None,
    _: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
) -> list[dict]:
    """كميات انتهاء الصلاحية — lots at or before a cutoff that still hold stock, soonest first."""
    return batch_service.expiring(db, before=before, item_id=item_id,
                                  location_kind=location_kind, location_id=location_id)


@router.get("/on-hand", response_model=OnHandOut)
def get_on_hand(
    item_id: int,
    location_kind: LocationKind,
    location_id: int,
    current: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
) -> OnHandOut:
    _assert_readable(db, current, location_kind, location_id)
    return OnHandOut(
        item_id=item_id, location_kind=location_kind, location_id=location_id,
        on_hand=on_hand(db, item_id, location_kind, location_id),
    )


@router.get("/by-location", response_model=list[LocationStockRow])
def stock_by_location(
    location_kind: LocationKind,
    location_id: int,
    only_available: bool = True,
    current: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
) -> list[LocationStockRow]:
    """Everything held at ONE location with its derived on-hand, in a single grouped query.

    Drives pickers that must only offer what is actually there (transfers, custody handovers):
    with `only_available` the caller never even sees an item it cannot move out.
    """
    _assert_readable(db, current, location_kind, location_id)
    signed = case(
        (StockMovement.direction == StockDirection.in_, StockMovement.quantity),
        else_=-StockMovement.quantity,
    )
    rows = db.execute(
        select(
            Item.id, Item.code, Item.name, Item.category, Item.unit_of_measure,
            func.coalesce(func.sum(signed), 0).label("qty"),
        )
        .join(StockMovement, StockMovement.item_id == Item.id)
        .where(
            StockMovement.location_kind == location_kind,
            StockMovement.location_id == location_id,
        )
        .group_by(Item.id, Item.code, Item.name, Item.category, Item.unit_of_measure)
        .order_by(Item.name)
    ).all()
    out = [
        LocationStockRow(item_id=r[0], code=r[1], name=r[2], category=r[3],
                         unit_of_measure=r[4], on_hand=Decimal(str(r[5] or 0)))
        for r in rows
    ]
    return [r for r in out if r.on_hand > 0] if only_available else out
