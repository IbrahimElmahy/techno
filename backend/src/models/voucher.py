from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK
from src.core.money import MONEY


class VoucherKind(str, enum.Enum):
    receipt = "receipt"
    payment = "payment"
    rep_handover = "rep_handover"
    expense = "expense"
    cash_transfer = "cash_transfer"
    partner_withdraw = "partner_withdraw"
    partner_deposit = "partner_deposit"


class Voucher(Base):
    __tablename__ = "voucher"

    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True,
                                                  index=True)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    cost_center_id: Mapped[int | None] = mapped_column(
        ForeignKey("cost_center.id"), nullable=True, index=True
    )
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    client_uuid: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True,
                                                    index=True)
    kind: Mapped[VoucherKind] = mapped_column(
        Enum(VoucherKind, native_enum=False, length=16), nullable=False, index=True
    )
    amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customer.id"), nullable=True,
                                                    index=True)
    family: Mapped[str | None] = mapped_column(String(40), nullable=True)
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("supplier.id"), nullable=True,
                                                    index=True)
    rep_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True,
                                                    index=True)
    cash_account_id: Mapped[int] = mapped_column(ForeignKey("account.id"), nullable=False)
    party_account_id: Mapped[int] = mapped_column(ForeignKey("account.id"), nullable=False)
    treasury_id: Mapped[int | None] = mapped_column(ForeignKey("treasury.id"), nullable=True,
                                                    index=True)
    to_treasury_id: Mapped[int | None] = mapped_column(ForeignKey("treasury.id"),
                                                       nullable=True)

    voucher_date: Mapped[date] = mapped_column(Date, nullable=False)
    payment_method: Mapped[str | None] = mapped_column(String(32), nullable=True)
    reference: Mapped[str | None] = mapped_column(String(80), nullable=True)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    external_document_number: Mapped[str | None] = mapped_column(
        String(40), nullable=True, index=True)
    statement1: Mapped[str | None] = mapped_column(String(200), nullable=True)

    ledger_entry_id: Mapped[int | None] = mapped_column(ForeignKey("ledger_entry.id"),
                                                        nullable=True)
    reverses_id: Mapped[int | None] = mapped_column(
        ForeignKey("voucher.id"), unique=True, nullable=True
    )
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
