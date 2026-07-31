"""حجز عملاء — 031-a5-restructure.

The only thing a reservation does is make stock unavailable to somebody else, so the whole feature
lives or dies on `held_against`. A reservations screen that did not feed the availability check
would be a list of promises with nothing keeping them.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.core.money import to_qty
from src.models.customer import Customer
from src.models.catalog import Item
from src.models.reservation import Reservation, ReservationStatus
from src.models.stock import LocationKind
from src.services import audit_service, stock_service

ZERO = to_qty(0)


class ReservationError(Exception):
    pass


def _doc_number(db: Session) -> str:
    n = db.scalar(select(func.count()).select_from(Reservation)) or 0
    return f"RES-{n + 1:06d}"


def _holding(as_of: date | None = None):
    """The filter for «is this reservation holding stock right now».

    Expiry is a comparison, not a status: a nightly sweeper would leave every screen wrong for as
    long as it was late, and «active» would mean «active, probably» everywhere it was read.
    """
    today = as_of or date.today()
    return (Reservation.status == ReservationStatus.active, Reservation.expires_on >= today)


def held_against(
    db: Session, *, item_id: int, location_kind: LocationKind, location_id: int,
    except_customer_id: int | None = None, as_of: date | None = None,
) -> Decimal:
    """How much of this item at this place is spoken for.

    `except_customer_id` is the point of the whole function: the customer a reservation was made
    FOR must be able to buy it. Without that exclusion the reservation would block the one sale it
    exists to guarantee.
    """
    stmt = select(Reservation).where(
        Reservation.item_id == item_id,
        Reservation.location_kind == location_kind,
        Reservation.location_id == location_id,
        *_holding(as_of),
    )
    if except_customer_id is not None:
        stmt = stmt.where(Reservation.customer_id != except_customer_id)
    rows = db.scalars(stmt).all()
    return to_qty(sum((Decimal(str(r.quantity)) for r in rows), Decimal("0")))


def available(
    db: Session, *, item_id: int, location_kind: LocationKind, location_id: int,
    for_customer_id: int | None = None, as_of: date | None = None,
) -> Decimal:
    """On-hand less what is held for anybody else. Never negative."""
    on_hand = stock_service.on_hand(db, item_id, location_kind, location_id)
    held = held_against(db, item_id=item_id, location_kind=location_kind,
                        location_id=location_id, except_customer_id=for_customer_id, as_of=as_of)
    free = to_qty(Decimal(str(on_hand)) - Decimal(str(held)))
    return free if free > ZERO else ZERO


def create(
    db: Session, *, customer_id: int, item_id: int, location_kind: LocationKind,
    location_id: int, quantity, expires_on: date, actor_user_id: int,
    notes: str | None = None,
) -> Reservation:
    """Hold stock for a customer until a date.

    Refused if the goods are not there to hold. Reserving what does not exist is how a counter ends
    up with two promises over one unit — and the second person finds out at the door.
    """
    qty = to_qty(quantity)
    if qty <= ZERO:
        raise ReservationError("الكمية المحجوزة لازم تكون أكبر من صفر.")
    if expires_on is None:
        raise ReservationError("الحجز لازم يكون ليه تاريخ انتهاء.")
    if expires_on < date.today():
        raise ReservationError("تاريخ انتهاء الحجز عدّى — الحجز ده مش هيمسك حاجة.")
    if db.get(Customer, customer_id) is None:
        raise ReservationError("العميل غير موجود.")
    if db.get(Item, item_id) is None:
        raise ReservationError("الصنف غير موجود.")

    free = available(db, item_id=item_id, location_kind=location_kind,
                     location_id=location_id, for_customer_id=customer_id)
    if qty > free:
        raise ReservationError(
            f"المتاح للحجز {free} أقل من المطلوب {qty} — الباقي محجوز لعملاء تانيين أو مش موجود."
        )

    row = Reservation(
        document_number=_doc_number(db), customer_id=customer_id, item_id=item_id,
        location_kind=location_kind, location_id=location_id, quantity=qty,
        expires_on=expires_on, status=ReservationStatus.active,
        notes=(notes or None), actor_user_id=actor_user_id,
    )
    db.add(row)
    db.flush()
    audit_service.record(db, action="reservation.create", actor_user_id=actor_user_id,
                         entity_type="reservation", entity_id=row.id,
                         after={"doc": row.document_number, "qty": str(qty)})
    return row


def cancel(db: Session, *, reservation_id: int, actor_user_id: int) -> Reservation:
    """Release a hold by hand. A converted one is not cancellable — the sale already happened."""
    row = db.get(Reservation, reservation_id)
    if row is None:
        raise ReservationError("الحجز غير موجود.")
    if row.status == ReservationStatus.converted:
        raise ReservationError("الحجز ده اتحوّل لفاتورة — الفاتورة هي اللي تترجع، مش الحجز.")
    if row.status == ReservationStatus.cancelled:
        raise ReservationError("الحجز ملغي بالفعل.")
    row.status = ReservationStatus.cancelled
    db.flush()
    audit_service.record(db, action="reservation.cancel", actor_user_id=actor_user_id,
                         entity_type="reservation", entity_id=row.id,
                         after={"doc": row.document_number})
    return row


def mark_converted(db: Session, *, reservation_id: int, invoice_id: int) -> Reservation:
    """Stamp the invoice a reservation turned into, so it stops holding and can be traced."""
    row = db.get(Reservation, reservation_id)
    if row is None:
        raise ReservationError("الحجز غير موجود.")
    if row.status != ReservationStatus.active:
        raise ReservationError("الحجز مش نشط.")
    row.status = ReservationStatus.converted
    row.sales_invoice_id = invoice_id
    db.flush()
    return row


def listing(db: Session, *, customer_id: int | None = None, item_id: int | None = None,
            only_holding: bool = False) -> list[Reservation]:
    stmt = select(Reservation)
    if customer_id is not None:
        stmt = stmt.where(Reservation.customer_id == customer_id)
    if item_id is not None:
        stmt = stmt.where(Reservation.item_id == item_id)
    if only_holding:
        stmt = stmt.where(*_holding())
    return list(db.scalars(stmt.order_by(Reservation.id.desc())).all())
