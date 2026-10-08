from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import BigInteger, Date, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK
from src.core.money import FACTOR, MONEY, PCT, QTY
from src.models.stock import LocationKind


class PurchaseInvoice(Base):
    __tablename__ = "purchase_invoice"

    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True,
                                                  index=True)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("supplier.id"), nullable=False)
    location_kind: Mapped[LocationKind] = mapped_column(Enum(LocationKind), nullable=False)
    location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    rep_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    expense_account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"), nullable=True)
    external_document_number: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    cost_center_id: Mapped[int | None] = mapped_column(
        ForeignKey("cost_center.id"), nullable=True, index=True
    )
    statement1: Mapped[str | None] = mapped_column(String(200), nullable=True)
    statement2: Mapped[str | None] = mapped_column(String(200), nullable=True)
    statement3: Mapped[str | None] = mapped_column(String(200), nullable=True)
    purchase_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    gross: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    fixed_discount_pct: Mapped[object] = mapped_column(PCT, nullable=False, default=0)
    variable_discount_pct: Mapped[object] = mapped_column(PCT, nullable=False, default=0)
    combined_pct: Mapped[object] = mapped_column(PCT, nullable=False, default=0)
    net: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    tax_amount: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    total: Mapped[object] = mapped_column(MONEY, nullable=False)
    cash_amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    credit_amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    ledger_entry_id: Mapped[int | None] = mapped_column(ForeignKey("ledger_entry.id"), nullable=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    lines: Mapped[list[PurchaseInvoiceLine]] = relationship(
        cascade="all, save-update", order_by="PurchaseInvoiceLine.id")


class PurchaseInvoiceLine(Base):
    __tablename__ = "purchase_invoice_line"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("purchase_invoice.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    unit_price: Mapped[object] = mapped_column(MONEY, nullable=False)
    discount_pct: Mapped[object | None] = mapped_column(PCT, nullable=True)
    fixed_discount_pct: Mapped[object | None] = mapped_column(PCT, nullable=True)
    variable_discount_pct: Mapped[object | None] = mapped_column(PCT, nullable=True)
    line_total: Mapped[object] = mapped_column(MONEY, nullable=False)
    unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    unit_factor: Mapped[object] = mapped_column(FACTOR, default=1, nullable=False)
    line_location_kind: Mapped[LocationKind | None] = mapped_column(Enum(LocationKind), nullable=True)
    line_location_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)


class PurchaseReturn(Base):
    __tablename__ = "purchase_return"

    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True,
                                                  index=True)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    purchase_invoice_id: Mapped[int | None] = mapped_column(
        ForeignKey("purchase_invoice.id"), nullable=True
    )
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("supplier.id"), nullable=True)
    origin_location_kind: Mapped[LocationKind | None] = mapped_column(
        Enum(LocationKind), nullable=True)
    origin_location_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    expense_account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"), nullable=True)
    external_document_number: Mapped[str | None] = mapped_column(String(40), nullable=True)
    statement1: Mapped[str | None] = mapped_column(String(200), nullable=True)
    statement2: Mapped[str | None] = mapped_column(String(200), nullable=True)
    statement3: Mapped[str | None] = mapped_column(String(200), nullable=True)
    gross: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    variable_discount_pct: Mapped[object] = mapped_column(PCT, nullable=False, default=0)
    combined_pct: Mapped[object] = mapped_column(PCT, nullable=False, default=0)
    value: Mapped[object] = mapped_column(MONEY, nullable=False)
    return_date: Mapped[object | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    cost_center_id: Mapped[int | None] = mapped_column(
        ForeignKey("cost_center.id"), nullable=True, index=True
    )
    ledger_entry_id: Mapped[int | None] = mapped_column(ForeignKey("ledger_entry.id"), nullable=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    reversed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reversal_entry_id: Mapped[int | None] = mapped_column(
        ForeignKey("ledger_entry.id"), nullable=True)

    lines: Mapped[list[PurchaseReturnLine]] = relationship(
        cascade="all, save-update", order_by="PurchaseReturnLine.id")


class PurchaseReturnLine(Base):
    __tablename__ = "purchase_return_line"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    return_id: Mapped[int] = mapped_column(ForeignKey("purchase_return.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    unit_price: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    discount_pct: Mapped[object | None] = mapped_column(PCT, nullable=True)
    fixed_discount_pct: Mapped[object | None] = mapped_column(PCT, nullable=True)
    variable_discount_pct: Mapped[object | None] = mapped_column(PCT, nullable=True)
    unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    unit_factor: Mapped[object] = mapped_column(FACTOR, default=1, nullable=False)
    line_location_kind: Mapped[LocationKind | None] = mapped_column(
        Enum(LocationKind), nullable=True)
    line_location_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    line_total: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
