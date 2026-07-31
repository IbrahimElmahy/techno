"""حجز عملاء — stock held for a customer without being sold to them yet (031).

A reservation is the one document that changes what a DIFFERENT screen is allowed to do. It moves
nothing, owes nothing and bills nothing; its whole effect is that somebody else cannot take the
goods. Recording it in a screen of its own without wiring it into the availability check would give
the counter a list of promises with nothing keeping them.

It expires. A promise with no end date holds stock forever, and the person who made it has left by
the time anybody notices — so a reservation has a day it stops holding, and after that day the
goods are available again without anyone having to remember to release them.
"""
from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import (
    BigInteger, DateTime, Date, Enum, ForeignKey, Index, String, func,
)
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK
from src.core.money import QTY
from src.models.stock import LocationKind


class ReservationStatus(str, enum.Enum):
    active = "active"
    converted = "converted"    # became an invoice
    cancelled = "cancelled"    # released by hand


class Reservation(Base):
    """Quantity of one item held at one location for one customer until a date.

    **Expiry is derived, not swept.** A reservation stops holding stock the day after
    `expires_on`, and that is computed wherever availability is read rather than written back by a
    nightly job. A status column saying «expired» would be wrong for as long as the job was late,
    and every screen reading it would be wrong with it.
    """

    __tablename__ = "reservation"
    __table_args__ = (
        # The availability check runs on every sale line: item × place, active only.
        Index("ix_reservation_hold", "item_id", "location_kind", "location_id", "status"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customer.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    location_kind: Mapped[LocationKind] = mapped_column(Enum(LocationKind), nullable=False)
    location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    # The last day it holds. Required: see the class docstring.
    expires_on: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[ReservationStatus] = mapped_column(
        Enum(ReservationStatus), default=ReservationStatus.active, nullable=False
    )
    # Set when the reservation becomes a sale, so the two can be read against each other.
    sales_invoice_id: Mapped[int | None] = mapped_column(
        ForeignKey("sales_invoice.id"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
