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
    converted = "converted"
    cancelled = "cancelled"


class Reservation(Base):
    __tablename__ = "reservation"
    __table_args__ = (
        Index("ix_reservation_hold", "item_id", "location_kind", "location_id", "status"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customer.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    location_kind: Mapped[LocationKind] = mapped_column(Enum(LocationKind), nullable=False)
    location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    expires_on: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[ReservationStatus] = mapped_column(
        Enum(ReservationStatus), default=ReservationStatus.active, nullable=False
    )
    sales_invoice_id: Mapped[int | None] = mapped_column(
        ForeignKey("sales_invoice.id"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
