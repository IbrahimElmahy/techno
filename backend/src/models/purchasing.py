"""Purchases + partial returns (T020). FR-010–012. Raw materials in; supplier credit; proportional
return money reversal."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK
from src.core.money import MONEY, QTY
from src.models.stock import LocationKind


class PurchaseInvoice(Base):
    __tablename__ = "purchase_invoice"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("supplier.id"), nullable=False)
    location_kind: Mapped[LocationKind] = mapped_column(Enum(LocationKind), nullable=False)
    location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    total: Mapped[object] = mapped_column(MONEY, nullable=False)
    cash_amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    credit_amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    ledger_entry_id: Mapped[int] = mapped_column(ForeignKey("ledger_entry.id"), nullable=False)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    lines: Mapped[list["PurchaseInvoiceLine"]] = relationship(cascade="all, save-update")


class PurchaseInvoiceLine(Base):
    __tablename__ = "purchase_invoice_line"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("purchase_invoice.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    unit_price: Mapped[object] = mapped_column(MONEY, nullable=False)  # per-invoice snapshot
    line_total: Mapped[object] = mapped_column(MONEY, nullable=False)


class PurchaseReturn(Base):
    __tablename__ = "purchase_return"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    purchase_invoice_id: Mapped[int] = mapped_column(
        ForeignKey("purchase_invoice.id"), nullable=False
    )
    value: Mapped[object] = mapped_column(MONEY, nullable=False)
    ledger_entry_id: Mapped[int] = mapped_column(ForeignKey("ledger_entry.id"), nullable=False)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    lines: Mapped[list["PurchaseReturnLine"]] = relationship(cascade="all, save-update")


class PurchaseReturnLine(Base):
    __tablename__ = "purchase_return_line"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    return_id: Mapped[int] = mapped_column(ForeignKey("purchase_return.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
