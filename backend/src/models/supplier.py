"""Suppliers + payable accounts (T019). FR-009. Mirrors Foundation customer/customer_account."""
from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK


class Supplier(Base):
    __tablename__ = "supplier"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(24), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    account: Mapped["SupplierAccount"] = relationship(back_populates="supplier", uselist=False)


class SupplierAccount(Base):
    """Payables / ذمم موردين. Balance derived from the linked supplier_payable ledger account."""

    __tablename__ = "supplier_account"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("supplier.id"), unique=True, nullable=False)
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id"), nullable=False)

    supplier: Mapped["Supplier"] = relationship(back_populates="account")
