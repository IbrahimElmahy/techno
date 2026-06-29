"""Sales invoices + partial returns + settings (T034). FR-017–021, FR-029.

Combined-% discount once on gross; split cash/credit summing to net; returns reverse money
proportionally (cash_refund/credit_reduction are system-derived, not caller-set).
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Enum, ForeignKey, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK
from src.core.money import MONEY, QTY
from src.models.stock import LocationKind

PCT = Numeric(5, 2)


class SalesInvoice(Base):
    __tablename__ = "sales_invoice"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customer.id"), nullable=False)
    origin_location_kind: Mapped[LocationKind] = mapped_column(Enum(LocationKind), nullable=False)
    origin_location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    gross: Mapped[object] = mapped_column(MONEY, nullable=False)
    fixed_discount_pct: Mapped[object] = mapped_column(PCT, nullable=False)
    variable_discount_pct: Mapped[object] = mapped_column(PCT, nullable=False)
    combined_pct: Mapped[object] = mapped_column(PCT, nullable=False)
    net: Mapped[object] = mapped_column(MONEY, nullable=False)
    cash_amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    credit_amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    cash_account_id: Mapped[int] = mapped_column(ForeignKey("account.id"), nullable=False)
    ledger_entry_id: Mapped[int] = mapped_column(ForeignKey("ledger_entry.id"), nullable=False)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    lines: Mapped[list["SalesInvoiceLine"]] = relationship(cascade="all, save-update")


class SalesInvoiceLine(Base):
    __tablename__ = "sales_invoice_line"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("sales_invoice.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    unit_price: Mapped[object] = mapped_column(MONEY, nullable=False)  # product fixed-price snapshot
    line_total: Mapped[object] = mapped_column(MONEY, nullable=False)


class SalesReturn(Base):
    __tablename__ = "sales_return"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    sales_invoice_id: Mapped[int] = mapped_column(ForeignKey("sales_invoice.id"), nullable=False)
    value: Mapped[object] = mapped_column(MONEY, nullable=False)
    cash_refund: Mapped[object] = mapped_column(MONEY, nullable=False)       # derived
    credit_reduction: Mapped[object] = mapped_column(MONEY, nullable=False)  # derived
    ledger_entry_id: Mapped[int] = mapped_column(ForeignKey("ledger_entry.id"), nullable=False)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    lines: Mapped[list["SalesReturnLine"]] = relationship(cascade="all, save-update")


class SalesReturnLine(Base):
    __tablename__ = "sales_return_line"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    return_id: Mapped[int] = mapped_column(ForeignKey("sales_return.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)


class SalesSetting(Base):
    """Singleton runtime sales settings (fixed discount %)."""

    __tablename__ = "sales_setting"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    fixed_discount_pct: Mapped[object] = mapped_column(PCT, default=0, nullable=False)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
