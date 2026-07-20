"""Cash vouchers — 018-finance-vouchers (سندات القبض والصرف وتوريد المندوب).

Closes the money cycle the system was missing: a credit invoice created a receivable that
could never be settled except through a raw journal entry. Each voucher posts exactly one
balanced ledger entry and is reversible once, like every other document here.

    receipt      سند قبض        debit cash location  / credit customer receivable
    payment      سند صرف        debit supplier payable / credit cash location
    rep_handover توريد مندوب    debit treasury        / credit the rep's custody
"""
from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK
from src.core.money import MONEY


class VoucherKind(str, enum.Enum):
    receipt = "receipt"            # تحصيل من عميل
    payment = "payment"            # دفع لمورد
    rep_handover = "rep_handover"  # توريد المندوب لخزينة الشركة


class Voucher(Base):
    __tablename__ = "voucher"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    kind: Mapped[VoucherKind] = mapped_column(
        Enum(VoucherKind, native_enum=False, length=16), nullable=False, index=True
    )
    amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    # The party this voucher settles with — exactly one is set per kind.
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customer.id"), nullable=True,
                                                    index=True)
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("supplier.id"), nullable=True,
                                                    index=True)
    rep_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True,
                                                    index=True)
    # Both sides of the posting, snapshotted for the voucher list/report.
    cash_account_id: Mapped[int] = mapped_column(ForeignKey("account.id"), nullable=False)
    party_account_id: Mapped[int] = mapped_column(ForeignKey("account.id"), nullable=False)

    voucher_date: Mapped[date] = mapped_column(Date, nullable=False)
    payment_method: Mapped[str | None] = mapped_column(String(32), nullable=True)  # نقدي/آجل...
    reference: Mapped[str | None] = mapped_column(String(80), nullable=True)  # رقم الإيصال/الشيك
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Nullable so the voucher row can exist before its entry (Postgres enforces FKs immediately).
    ledger_entry_id: Mapped[int | None] = mapped_column(ForeignKey("ledger_entry.id"),
                                                        nullable=True)
    reverses_id: Mapped[int | None] = mapped_column(
        ForeignKey("voucher.id"), unique=True, nullable=True
    )
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
