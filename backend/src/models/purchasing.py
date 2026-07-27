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
    # Now only the DEFAULT for new lines — each line carries its own warehouse (030).
    location_kind: Mapped[LocationKind] = mapped_column(Enum(LocationKind), nullable=False)
    location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    # --- 030 document fields (mirrors the sales invoice) ---
    rep_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    expense_account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"), nullable=True)
    # The SUPPLIER's own invoice number — kept alongside our generated document_number.
    external_document_number: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    statement1: Mapped[str | None] = mapped_column(String(200), nullable=True)
    statement2: Mapped[str | None] = mapped_column(String(200), nullable=True)
    statement3: Mapped[str | None] = mapped_column(String(200), nullable=True)
    total: Mapped[object] = mapped_column(MONEY, nullable=False)
    cash_amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    credit_amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    # Nullable so the row can be inserted before its ledger entry exists (Postgres enforces FKs;
    # a 0 placeholder would violate the constraint). Always set to the real id before commit.
    ledger_entry_id: Mapped[int | None] = mapped_column(ForeignKey("ledger_entry.id"), nullable=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    lines: Mapped[list[PurchaseInvoiceLine]] = relationship(cascade="all, save-update")


class PurchaseInvoiceLine(Base):
    __tablename__ = "purchase_invoice_line"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("purchase_invoice.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    unit_price: Mapped[object] = mapped_column(MONEY, nullable=False)  # per chosen unit snapshot
    line_total: Mapped[object] = mapped_column(MONEY, nullable=False)
    # Unit of measure used on this line (008); NULL = base. Stock in base = quantity × unit_factor.
    unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    unit_factor: Mapped[object] = mapped_column(QTY, default=1, nullable=False)
    # (030) The warehouse THIS line is received into. NULL only on pre-030 rows, which the
    # migration backfills from the invoice.
    line_location_kind: Mapped[LocationKind | None] = mapped_column(Enum(LocationKind), nullable=True)
    line_location_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)


class PurchaseReturn(Base):
    __tablename__ = "purchase_return"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    purchase_invoice_id: Mapped[int] = mapped_column(
        ForeignKey("purchase_invoice.id"), nullable=False
    )
    value: Mapped[object] = mapped_column(MONEY, nullable=False)
    # Nullable so the row can be inserted before its ledger entry exists (Postgres enforces FKs;
    # a 0 placeholder would violate the constraint). Always set to the real id before commit.
    ledger_entry_id: Mapped[int | None] = mapped_column(ForeignKey("ledger_entry.id"), nullable=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    lines: Mapped[list[PurchaseReturnLine]] = relationship(cascade="all, save-update")


class PurchaseReturnLine(Base):
    __tablename__ = "purchase_return_line"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    return_id: Mapped[int] = mapped_column(ForeignKey("purchase_return.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
