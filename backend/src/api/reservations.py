"""حجز عملاء — 031-a5-restructure."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_SALE_WRITE, CAP_SALES_READ
from src.core.db import get_db
from src.models.catalog import Item
from src.models.customer import Customer
from src.models.reservation import Reservation, ReservationStatus
from src.models.stock import LocationKind
from src.models.warehouse import Warehouse
from src.services import reservation_service
from src.services.reservation_service import ReservationError

router = APIRouter(tags=["reservations"], prefix="/reservations")


class LocationIn(BaseModel):
    location_kind: LocationKind
    location_id: int


class ReservationIn(BaseModel):
    customer_id: int
    item_id: int
    location: LocationIn
    quantity: Decimal
    expires_on: date
    notes: str | None = Field(default=None, max_length=500)


class ReservationOut(BaseModel):
    id: int
    document_number: str
    customer_id: int
    customer_name: str | None
    item_id: int
    item_name: str | None
    location_kind: str
    location_id: int
    location_name: str | None
    quantity: Decimal
    expires_on: str
    status: str
    # Derived from the date, not stored — see `reservation_service._holding`.
    holding: bool
    sales_invoice_id: int | None
    notes: str | None
    created_at: str


class AvailabilityOut(BaseModel):
    item_id: int
    location_kind: str
    location_id: int
    on_hand: Decimal
    reserved_for_others: Decimal
    available: Decimal


def _out(r: Reservation, customers, items, warehouses) -> ReservationOut:
    return ReservationOut(
        id=r.id, document_number=r.document_number,
        customer_id=r.customer_id, customer_name=customers.get(r.customer_id),
        item_id=r.item_id, item_name=items.get(r.item_id),
        location_kind=r.location_kind.value, location_id=r.location_id,
        location_name=(warehouses.get(r.location_id)
                       if r.location_kind == LocationKind.warehouse
                       else f"عهدة #{r.location_id}"),
        quantity=r.quantity, expires_on=str(r.expires_on), status=r.status.value,
        holding=(r.status == ReservationStatus.active and r.expires_on >= date.today()),
        sales_invoice_id=r.sales_invoice_id, notes=r.notes, created_at=str(r.created_at),
    )


def _names(db: Session):
    return (
        {c.id: c.name for c in db.scalars(select(Customer)).all()},
        {i.id: i.name for i in db.scalars(select(Item)).all()},
        {w.id: w.name for w in db.scalars(select(Warehouse)).all()},
    )


@router.get("", response_model=list[ReservationOut])
def list_reservations(
    customer_id: int | None = None,
    item_id: int | None = None,
    only_holding: bool = Query(default=False, description="only the ones actually holding stock"),
    _: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
) -> list[ReservationOut]:
    customers, items, warehouses = _names(db)
    rows = reservation_service.listing(db, customer_id=customer_id, item_id=item_id,
                                       only_holding=only_holding)
    return [_out(r, customers, items, warehouses) for r in rows]


@router.get("/availability", response_model=AvailabilityOut)
def availability(
    item_id: int,
    location_kind: LocationKind,
    location_id: int,
    for_customer_id: int | None = None,
    _: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
) -> AvailabilityOut:
    """What is actually sellable here, and how much of the shortfall is somebody else's hold.

    Both numbers, not just the answer: «you cannot sell 5» and «you cannot sell 5 because 3 are
    held for another customer» lead to different next actions.
    """
    from src.services import stock_service
    on_hand = stock_service.on_hand(db, item_id, location_kind, location_id)
    held = reservation_service.held_against(
        db, item_id=item_id, location_kind=location_kind, location_id=location_id,
        except_customer_id=for_customer_id)
    free = reservation_service.available(
        db, item_id=item_id, location_kind=location_kind, location_id=location_id,
        for_customer_id=for_customer_id)
    return AvailabilityOut(
        item_id=item_id, location_kind=location_kind.value, location_id=location_id,
        on_hand=on_hand, reserved_for_others=held, available=free,
    )


@router.post("", response_model=ReservationOut, status_code=status.HTTP_201_CREATED)
def create_reservation(
    body: ReservationIn,
    current: CurrentUser = Depends(require_capability(CAP_SALE_WRITE)),
    db: Session = Depends(get_db),
) -> ReservationOut:
    try:
        row = reservation_service.create(
            db, customer_id=body.customer_id, item_id=body.item_id,
            location_kind=body.location.location_kind, location_id=body.location.location_id,
            quantity=body.quantity, expires_on=body.expires_on,
            actor_user_id=current.id, notes=body.notes,
        )
    except ReservationError as exc:
        raise HTTPException(409, {"code": "reservation_invalid", "message": str(exc)}) from exc
    db.commit()
    customers, items, warehouses = _names(db)
    return _out(row, customers, items, warehouses)


@router.post("/{reservation_id}/cancel", response_model=ReservationOut)
def cancel_reservation(
    reservation_id: int,
    current: CurrentUser = Depends(require_capability(CAP_SALE_WRITE)),
    db: Session = Depends(get_db),
) -> ReservationOut:
    try:
        row = reservation_service.cancel(db, reservation_id=reservation_id,
                                         actor_user_id=current.id)
    except ReservationError as exc:
        raise HTTPException(409, {"code": "reservation_invalid", "message": str(exc)}) from exc
    db.commit()
    customers, items, warehouses = _names(db)
    return _out(row, customers, items, warehouses)
