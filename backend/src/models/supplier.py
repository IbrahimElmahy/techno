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
    address: Mapped[str | None] = mapped_column(String(240), nullable=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True)
    governorate_id: Mapped[int | None] = mapped_column(ForeignKey("governorate.id"),
                                                       nullable=True)
    markaz: Mapped[str | None] = mapped_column(String(120), nullable=True)
    supplier_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    email: Mapped[str | None] = mapped_column(String(160), nullable=True)
    tax_number: Mapped[str | None] = mapped_column(String(40), nullable=True)
    commercial_register: Mapped[str | None] = mapped_column(String(40), nullable=True)
    is_cash: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    account: Mapped[SupplierAccount] = relationship(back_populates="supplier", uselist=False)


class SupplierAccount(Base):
    __tablename__ = "supplier_account"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("supplier.id"), unique=True, nullable=False)
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id"), nullable=False)

    supplier: Mapped[Supplier] = relationship(back_populates="account")
