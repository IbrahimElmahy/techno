from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger, Boolean, Date, DateTime, Enum, ForeignKey, Integer, String, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK
from src.core.money import FACTOR, MONEY, PCT, QTY
from src.models.catalog import PriceTier
from src.models.stock import LocationKind



class SalesInvoice(Base):
    __tablename__ = "sales_invoice"

    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True,
                                                  index=True)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customer.id"), nullable=False)
    origin_location_kind: Mapped[LocationKind] = mapped_column(Enum(LocationKind), nullable=False)
    origin_location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    rep_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    revenue_account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"), nullable=True)
    external_document_number: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    prior_balance: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    other_family_balance: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    other_family: Mapped[str | None] = mapped_column(String(16), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    cost_center_id: Mapped[int | None] = mapped_column(
        ForeignKey("cost_center.id"), nullable=True, index=True
    )
    statement1: Mapped[str | None] = mapped_column(String(200), nullable=True)
    statement2: Mapped[str | None] = mapped_column(String(200), nullable=True)
    statement3: Mapped[str | None] = mapped_column(String(200), nullable=True)
    invoice_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    client_uuid: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True,
                                                    index=True)
    is_bonus: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    bonus_for_invoice_id: Mapped[int | None] = mapped_column(
        ForeignKey("sales_invoice.id"), nullable=True, index=True)
    expenses_billed: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    expenses_operating: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    coupon_serial_from: Mapped[str | None] = mapped_column(String(24), nullable=True, index=True)
    coupon_serial_to: Mapped[str | None] = mapped_column(String(24), nullable=True, index=True)
    coupon_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    gross: Mapped[object] = mapped_column(MONEY, nullable=False)
    fixed_discount_pct: Mapped[object] = mapped_column(PCT, nullable=False)
    variable_discount_pct: Mapped[object] = mapped_column(PCT, nullable=False)
    combined_pct: Mapped[object] = mapped_column(PCT, nullable=False)
    net: Mapped[object] = mapped_column(MONEY, nullable=False)
    tax_amount: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    family: Mapped[str | None] = mapped_column(String(40), nullable=True)
    cash_amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    credit_amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    cash_account_id: Mapped[int] = mapped_column(ForeignKey("account.id"), nullable=False)
    ledger_entry_id: Mapped[int | None] = mapped_column(ForeignKey("ledger_entry.id"), nullable=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    lines: Mapped[list[SalesInvoiceLine]] = relationship(
        cascade="all, save-update", order_by="SalesInvoiceLine.id")
    expenses: Mapped[list["SalesInvoiceExpense"]] = relationship(  # noqa: UP037
        back_populates="invoice", cascade="all, delete-orphan"
    )


class SalesInvoiceCoupon(Base):
    __tablename__ = "sales_invoice_coupon"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("sales_invoice.id"), nullable=False)
    coupon_kind: Mapped[str | None] = mapped_column(String(24), nullable=True, index=True)
    coupon_type_id: Mapped[int | None] = mapped_column(
        ForeignKey("coupon_type.id"), nullable=True
    )
    count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    serial_from: Mapped[str | None] = mapped_column(String(24), nullable=True)
    serial_to: Mapped[str | None] = mapped_column(String(24), nullable=True)


class SalesInvoiceLine(Base):
    __tablename__ = "sales_invoice_line"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("sales_invoice.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    unit_price: Mapped[object] = mapped_column(MONEY, nullable=False)
    discount_pct: Mapped[object] = mapped_column(PCT, default=0, nullable=False)
    fixed_discount_pct: Mapped[object | None] = mapped_column(PCT, nullable=True)
    variable_discount_pct: Mapped[object | None] = mapped_column(PCT, nullable=True)
    line_total: Mapped[object] = mapped_column(MONEY, nullable=False)
    price_tier: Mapped[PriceTier | None] = mapped_column(Enum(PriceTier), nullable=True)
    unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    unit_factor: Mapped[object] = mapped_column(FACTOR, default=1, nullable=False)
    location_kind: Mapped[LocationKind | None] = mapped_column(Enum(LocationKind), nullable=True)
    location_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    unit_cost: Mapped[object | None] = mapped_column(MONEY, nullable=True)


class SalesReturn(Base):
    __tablename__ = "sales_return"

    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True,
                                                  index=True)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    sales_invoice_id: Mapped[int | None] = mapped_column(ForeignKey("sales_invoice.id"), nullable=True)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customer.id"), nullable=True)
    origin_location_kind: Mapped[LocationKind | None] = mapped_column(Enum(LocationKind), nullable=True)
    origin_location_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    gross: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    combined_pct: Mapped[object] = mapped_column(PCT, default=0, nullable=False)
    value: Mapped[object] = mapped_column(MONEY, nullable=False)
    tax_amount: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    cash_refund: Mapped[object] = mapped_column(MONEY, nullable=False)
    credit_reduction: Mapped[object] = mapped_column(MONEY, nullable=False)
    cash_account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"), nullable=True)
    rep_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    revenue_account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"), nullable=True)
    external_document_number: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    cost_center_id: Mapped[int | None] = mapped_column(
        ForeignKey("cost_center.id"), nullable=True, index=True
    )
    statement1: Mapped[str | None] = mapped_column(String(200), nullable=True)
    statement2: Mapped[str | None] = mapped_column(String(200), nullable=True)
    statement3: Mapped[str | None] = mapped_column(String(200), nullable=True)
    family: Mapped[str | None] = mapped_column(String(40), nullable=True)
    return_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    ledger_entry_id: Mapped[int | None] = mapped_column(ForeignKey("ledger_entry.id"), nullable=True)
    reversed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reversal_entry_id: Mapped[int | None] = mapped_column(ForeignKey("ledger_entry.id"),
                                                          nullable=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    lines: Mapped[list[SalesReturnLine]] = relationship(
        cascade="all, save-update", order_by="SalesReturnLine.id")


class SalesReturnLine(Base):
    __tablename__ = "sales_return_line"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    return_id: Mapped[int] = mapped_column(ForeignKey("sales_return.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    unit_price: Mapped[object | None] = mapped_column(MONEY, nullable=True)
    discount_pct: Mapped[object] = mapped_column(PCT, default=0, nullable=False)
    fixed_discount_pct: Mapped[object | None] = mapped_column(PCT, nullable=True)
    variable_discount_pct: Mapped[object | None] = mapped_column(PCT, nullable=True)
    line_total: Mapped[object | None] = mapped_column(MONEY, nullable=True)
    unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    unit_factor: Mapped[object] = mapped_column(FACTOR, default=1, nullable=False)
    location_kind: Mapped[LocationKind | None] = mapped_column(Enum(LocationKind), nullable=True)
    location_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    unit_cost: Mapped[object | None] = mapped_column(MONEY, nullable=True)


class SalesSetting(Base):
    __tablename__ = "sales_setting"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    fixed_discount_pct: Mapped[object] = mapped_column(PCT, default=0, nullable=False)
    vat_rate_pct: Mapped[object] = mapped_column(PCT, default=0, nullable=False)
    edit_lock_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    purchase_poly_discount_pct: Mapped[object] = mapped_column(PCT, default=52.5, nullable=False)
    purchase_white_discount_pct: Mapped[object] = mapped_column(PCT, default=34.5, nullable=False)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
