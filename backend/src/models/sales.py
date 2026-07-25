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
from src.models.catalog import PriceTier
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
    # Output VAT charged on `net` (021); 0 when the tax rate is off. Payable = net + tax.
    tax_amount: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    cash_amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    credit_amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    cash_account_id: Mapped[int] = mapped_column(ForeignKey("account.id"), nullable=False)
    # Nullable so the row can be inserted before its ledger entry exists (see purchasing.py note).
    ledger_entry_id: Mapped[int | None] = mapped_column(ForeignKey("ledger_entry.id"), nullable=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    lines: Mapped[list[SalesInvoiceLine]] = relationship(cascade="all, save-update")


class SalesInvoiceLine(Base):
    __tablename__ = "sales_invoice_line"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("sales_invoice.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    unit_price: Mapped[object] = mapped_column(MONEY, nullable=False)  # list price snapshot (pre-discount)
    # Per-line discount % applied to this line (027): the item's fixed discount + a typed
    # variable discount, combined. line_total = quantity × unit_price × (1 − discount_pct/100).
    discount_pct: Mapped[object] = mapped_column(PCT, default=0, nullable=False)
    line_total: Mapped[object] = mapped_column(MONEY, nullable=False)  # AFTER the line discount
    # Resolved price tier snapshot (007); NULL for legacy 002 lines.
    price_tier: Mapped[PriceTier | None] = mapped_column(Enum(PriceTier), nullable=True)
    # Unit of measure used on this line (008); NULL = base unit. quantity is in this unit;
    # stock moved in base = quantity × unit_factor.
    unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    unit_factor: Mapped[object] = mapped_column(QTY, default=1, nullable=False)


class SalesReturn(Base):
    __tablename__ = "sales_return"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    # Invoice-bound returns (002) reference the original invoice. Standalone returns (028) — the
    # "return like a sale but reversed" flow: pick a customer + items directly — leave it NULL and
    # carry their own customer/location/cash-account instead.
    sales_invoice_id: Mapped[int | None] = mapped_column(ForeignKey("sales_invoice.id"), nullable=True)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customer.id"), nullable=True)
    # Where the returned goods go back into stock (standalone returns).
    origin_location_kind: Mapped[LocationKind | None] = mapped_column(Enum(LocationKind), nullable=True)
    origin_location_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # Document totals (standalone); invoice-bound returns leave gross/combined/tax at their defaults.
    gross: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    combined_pct: Mapped[object] = mapped_column(PCT, default=0, nullable=False)
    value: Mapped[object] = mapped_column(MONEY, nullable=False)  # net (after the invoice-level discount)
    tax_amount: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    cash_refund: Mapped[object] = mapped_column(MONEY, nullable=False)       # derived (invoice-bound) / chosen (standalone)
    credit_reduction: Mapped[object] = mapped_column(MONEY, nullable=False)  # derived (invoice-bound) / chosen (standalone)
    # Treasury the cash refund is paid from (standalone). NULL when there is no cash refund.
    cash_account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"), nullable=True)
    # Nullable so the row can be inserted before its ledger entry exists (see purchasing.py note).
    ledger_entry_id: Mapped[int | None] = mapped_column(ForeignKey("ledger_entry.id"), nullable=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    lines: Mapped[list[SalesReturnLine]] = relationship(cascade="all, save-update")


class SalesReturnLine(Base):
    __tablename__ = "sales_return_line"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    return_id: Mapped[int] = mapped_column(ForeignKey("sales_return.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    # Standalone returns record the refunded price per line (invoice-bound ones derive value from the
    # original invoice, so these stay NULL/default for them).
    unit_price: Mapped[object | None] = mapped_column(MONEY, nullable=True)
    discount_pct: Mapped[object] = mapped_column(PCT, default=0, nullable=False)
    line_total: Mapped[object | None] = mapped_column(MONEY, nullable=True)  # AFTER the line discount
    unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    unit_factor: Mapped[object] = mapped_column(QTY, default=1, nullable=False)


class SalesSetting(Base):
    """Singleton runtime sales settings (fixed discount %)."""

    __tablename__ = "sales_setting"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    fixed_discount_pct: Mapped[object] = mapped_column(PCT, default=0, nullable=False)
    # VAT / ضريبة القيمة المضافة (021). Zero = off, which is the shipped default: at 0 the
    # posting is byte-identical to the pre-VAT behaviour, so enabling it is a deliberate act.
    vat_rate_pct: Mapped[object] = mapped_column(PCT, default=0, nullable=False)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
