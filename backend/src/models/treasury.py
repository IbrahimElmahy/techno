"""Treasuries and the period lock — 019-finance-treasuries.

Until now «الخزينة» was a single hard-coded ledger account, so a company with a safe per
branch (or a bank account) had nowhere to put the money. A Treasury row names a cash location
and owns its ledger account; every cash movement can therefore say WHERE the money sat.

`PeriodLock` closes the books up to a date: nothing may post on or before `locked_through`.
"""
from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK


class TreasuryKind(str, enum.Enum):
    cash = "cash"  # خزينة نقدية
    bank = "bank"  # حساب بنكي


class Treasury(Base):
    __tablename__ = "treasury"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[TreasuryKind] = mapped_column(
        Enum(TreasuryKind, native_enum=False, length=8), nullable=False,
        default=TreasuryKind.cash,
    )
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True,
                                                  index=True)
    # Its ledger account — one per treasury, so balances come straight from the ledger.
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id"), unique=True,
                                            nullable=False)
    bank_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    account_number: Mapped[str | None] = mapped_column(String(60), nullable=True)
    # The safe used when a document does not name one (keeps every existing caller working).
    is_default: Mapped[bool] = mapped_column(default=False, nullable=False)
    active: Mapped[bool] = mapped_column(default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class PeriodLock(Base):
    """إقفال الفترة — the newest row wins; `locked_through` is inclusive."""

    __tablename__ = "period_lock"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    locked_through: Mapped[date] = mapped_column(Date, nullable=False)
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
