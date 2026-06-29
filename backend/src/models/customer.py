"""Customer & CustomerAccount models (T045–T046).

FR-018/018a/019/020/020a/021/023. Stable system-generated `code` identity; phone captured
but not unique. Owned by exactly one rep + one territory at a time (reassignable). No loyalty
column/table — loyalty is owned by the After-Sales spec (FR-022, constitution v1.1.2).
"""
from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK


class CustomerType(str, enum.Enum):
    trader = "trader"
    plumber = "plumber"
    other = "other"


class Customer(Base):
    __tablename__ = "customer"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(24), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    customer_type: Mapped[CustomerType] = mapped_column(Enum(CustomerType), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)  # not unique (FR-018a)
    rep_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    territory_id: Mapped[int] = mapped_column(ForeignKey("territory.id"), nullable=False)
    active: Mapped[bool] = mapped_column(default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    account: Mapped["CustomerAccount"] = relationship(back_populates="customer", uselist=False)


class CustomerAccount(Base):
    """Receivables / ذمم. Balance is derived from the linked ledger account (FR-021/026)."""

    __tablename__ = "customer_account"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    customer_id: Mapped[int] = mapped_column(
        ForeignKey("customer.id"), unique=True, nullable=False
    )
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    customer: Mapped["Customer"] = relationship(back_populates="account")
    account: Mapped["object"] = relationship("Account")
