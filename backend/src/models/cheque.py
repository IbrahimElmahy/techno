"""Cheques — 020-finance-reports (الشيكات).

A cheque is money promised, not money moved: it sits «تحت التحصيل» (incoming) or «تحت الدفع»
(outgoing) until it clears. Each stage posts its own ledger entry, so the books always show
where the value is — never a cheque silently treated as cash.

    incoming  استلام:  debit cheques-under-collection / credit customer receivable
              تحصيل:   debit treasury                 / credit cheques-under-collection
              ارتداد:  reverse the receipt (the customer owes again)

    outgoing  تحرير:   debit supplier payable         / credit cheques-payable
              صرف:     debit cheques-payable          / credit treasury
"""
from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK
from src.core.money import MONEY


class ChequeDirection(str, enum.Enum):
    incoming = "incoming"  # وارد من عميل (تحت التحصيل)
    outgoing = "outgoing"  # صادر لمورد (تحت الدفع)


class ChequeStatus(str, enum.Enum):
    pending = "pending"    # تحت التحصيل / تحت الدفع
    settled = "settled"    # حُصِّل أو صُرف
    bounced = "bounced"    # ارتد
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
    cheque_number: Mapped[str] = mapped_column(String(40), nullable=False)  # رقم الشيك
    bank_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    issue_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)  # الاستحقاق

    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customer.id"), nullable=True,
                                                    index=True)
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("supplier.id"), nullable=True,
                                                    index=True)
    # Where the money lands (incoming) or leaves from (outgoing) once it clears.
    treasury_id: Mapped[int | None] = mapped_column(ForeignKey("treasury.id"), nullable=True)

    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # The entry raised on registration, and the one raised on settlement/bounce.
    register_entry_id: Mapped[int | None] = mapped_column(ForeignKey("ledger_entry.id"),
                                                          nullable=True)
    settle_entry_id: Mapped[int | None] = mapped_column(ForeignKey("ledger_entry.id"),
                                                        nullable=True)
    settled_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
