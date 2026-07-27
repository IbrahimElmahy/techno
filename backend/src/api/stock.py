"""Stock router (T018): derived on-hand. FR-007."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_PURCHASE_WRITE, CAP_STOCK_READ, CAP_TRANSFER_INITIATE
from src.core.db import get_db
from src.models.catalog import Item
from src.models.stock import LocationKind, StockDirection, StockMovement
from src.models.warehouse import Custody
from src.services import batch_service, stock_permit_service
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


# ----------------------------------------------------- إذن إضافة / إذن صرف (B5)


class PermitLineIn(BaseModel):
    item_id: int
    quantity: Decimal
    # Only meaningful on a receipt; an issue is costed from the costing method.
    unit_cost: Decimal | None = None


class PermitIn(BaseModel):
    kind: str  # receipt | issue
    warehouse_id: int
    lines: list[PermitLineIn]
    reason: str | None = None
    notes: str | None = None
    permit_date: date | None = None


class PermitLineOut(BaseModel):
    id: int
    item_id: int
    item_name: str | None = None
    quantity: Decimal
    unit_cost: Decimal
    line_cost: Decimal


class PermitOut(BaseModel):
    id: int
    document_number: str
    kind: str
    warehouse_id: int
    warehouse_name: str | None = None
    permit_date: date | None = None
    reason: str | None = None
    notes: str | None = None
    total_cost: Decimal
    is_reversal: bool
    reversed_by: int | None = None
    created_at: datetime | None = None
    lines: list[PermitLineOut] = []


def _permit_out(db: Session, p) -> PermitOut:
    from src.models.stock_permit import StockPermit as _P
    from src.models.warehouse import Warehouse as _W

    item_names = {
        i.id: i.name for i in db.scalars(
            select(Item).where(Item.id.in_([ln.item_id for ln in p.lines] or [0]))).all()
    }
    warehouse = db.get(_W, p.warehouse_id)
    reversal = db.scalar(select(_P.id).where(_P.reverses_id == p.id))
    return PermitOut(
        id=p.id, document_number=p.document_number, kind=p.kind.value,
        warehouse_id=p.warehouse_id, warehouse_name=warehouse.name if warehouse else None,
        permit_date=p.permit_date, reason=p.reason, notes=p.notes,
        total_cost=p.total_cost, is_reversal=p.reverses_id is not None,
        reversed_by=reversal, created_at=p.created_at,
        lines=[PermitLineOut(
            id=ln.id, item_id=ln.item_id, item_name=item_names.get(ln.item_id),
            quantity=ln.quantity, unit_cost=ln.unit_cost, line_cost=ln.line_cost)
            for ln in p.lines],
    )


@router.post("/permits", response_model=PermitOut, status_code=201)
def create_permit(
    body: PermitIn,
    current: CurrentUser = Depends(require_capability(CAP_TRANSFER_INITIATE)),
    db: Session = Depends(get_db),
) -> PermitOut:
    """إذن إضافة أو إذن صرف — stock in or out for a reason that is not a trade.

    No-Negative-Stock applies here exactly as it does to a sale: an administrative document is
    still not allowed to invent stock.
    """
    try:
        permit = stock_permit_service.create_permit(
            db, kind=body.kind, warehouse_id=body.warehouse_id,
            lines=[ln.model_dump() for ln in body.lines], actor_user_id=current.id,
            reason=body.reason, notes=body.notes, permit_date=body.permit_date,
        )
    except stock_permit_service.StockPermitError as exc:
        raise HTTPException(422, {"code": "permit_invalid", "message": str(exc)}) from exc
    except StockError as exc:
        raise HTTPException(409, {"code": "insufficient_stock", "message": str(exc)}) from exc
    out = _permit_out(db, permit)
    db.commit()
    return out


@router.get("/permits", response_model=list[PermitOut])
def list_permits(
    kind: str | None = None,
    warehouse_id: int | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    _: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
) -> list[PermitOut]:
    rows = stock_permit_service.list_permits(
        db, kind=kind, warehouse_id=warehouse_id, date_from=date_from, date_to=date_to)
    return [_permit_out(db, p) for p in rows]


@router.get("/permits/{permit_id}", response_model=PermitOut)
def get_permit(
    permit_id: int,
    _: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
) -> PermitOut:
    try:
        return _permit_out(db, stock_permit_service.get_permit(db, permit_id))
    except stock_permit_service.StockPermitError as exc:
        raise HTTPException(404, {"code": "not_found", "message": str(exc)}) from exc


@router.post("/permits/{permit_id}/reverse", response_model=PermitOut, status_code=201)
def reverse_permit(
    permit_id: int,
    current: CurrentUser = Depends(require_capability(CAP_TRANSFER_INITIATE)),
    db: Session = Depends(get_db),
) -> PermitOut:
    """Posted documents are reversed, never edited or deleted — and only once."""
    try:
        reversal = stock_permit_service.reverse_permit(
            db, permit_id=permit_id, actor_user_id=current.id)
    except stock_permit_service.StockPermitError as exc:
        raise HTTPException(409, {"code": "permit_invalid", "message": str(exc)}) from exc
    except StockError as exc:
        raise HTTPException(409, {"code": "insufficient_stock", "message": str(exc)}) from exc
    out = _permit_out(db, reversal)
    db.commit()
    return out
