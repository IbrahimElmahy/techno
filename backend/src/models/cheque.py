from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK
from src.core.money import MONEY


class ChequeDirection(str, enum.Enum):
    incoming = "incoming"
    outgoing = "outgoing"


class ChequeStatus(str, enum.Enum):
    pending = "pending"
    settled = "settled"
    bounced = "bounced"
    cancelled = "cancelled"


class Cheque(Base):
    __tablename__ = "cheque"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    direction: Mapped[ChequeDirection] = mapped_column(
        Enum(ChequeDirection, native_enum=False, length=10), nullable=False, index=True
    )
    status: Mapped[ChequeStatus] = mapped_column(
        Enum(ChequeStatus, native_enum=False, length=10), nullable=False,
        default=ChequeStatus.pending, index=True,
    )
    cheque_number: Mapped[str] = mapped_column(String(40), nullable=False)
    bank_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    issue_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customer.id"), nullable=True,
                                                    index=True)
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("supplier.id"), nullable=True,
                                                    index=True)
    treasury_id: Mapped[int | None] = mapped_column(ForeignKey("treasury.id"), nullable=True)

    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    statement1: Mapped[str | None] = mapped_column(String(200), nullable=True)
    register_entry_id: Mapped[int | None] = mapped_column(ForeignKey("ledger_entry.id"),
                                                          nullable=True)
    settle_entry_id: Mapped[int | None] = mapped_column(ForeignKey("ledger_entry.id"),
                                                        nullable=True)
    settled_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
