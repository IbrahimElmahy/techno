from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK
from src.core.money import PCT
from src.models.catalog import PriceTier


class CustomerType(str, enum.Enum):
    trader = "trader"
    plumber = "plumber"
    owner = "owner"
    employee = "employee"
    other = "other"


class Customer(Base):
    __tablename__ = "customer"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(24), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    customer_type: Mapped[str] = mapped_column(String(32), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    governorate_id: Mapped[int | None] = mapped_column(ForeignKey("governorate.id"), nullable=True)
    markaz: Mapped[str | None] = mapped_column(String(120), nullable=True)
    address: Mapped[str | None] = mapped_column(String(240), nullable=True)
    employee_id: Mapped[int | None] = mapped_column(
        ForeignKey("employee.id"), nullable=True)
    rep_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    territory_id: Mapped[int] = mapped_column(ForeignKey("territory.id"), nullable=False)
    default_price_tier: Mapped[PriceTier | None] = mapped_column(Enum(PriceTier), nullable=True)
    service_rep_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("supplier.id"), nullable=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True)
    email: Mapped[str | None] = mapped_column(String(160), nullable=True)
    tax_number: Mapped[str | None] = mapped_column(String(40), nullable=True)
    commercial_register: Mapped[str | None] = mapped_column(String(40), nullable=True)
    discount_pct: Mapped[object | None] = mapped_column(PCT, nullable=True)
    vat_pct: Mapped[object | None] = mapped_column(PCT, nullable=True)
    default_return_warehouse_id: Mapped[int | None] = mapped_column(
        ForeignKey("warehouse.id"), nullable=True)
    is_cash: Mapped[bool] = mapped_column(default=False, nullable=False)
    active: Mapped[bool] = mapped_column(default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    account: Mapped[CustomerAccount] = relationship(
        back_populates="customer", uselist=False,
        primaryjoin="and_(Customer.id == CustomerAccount.customer_id, "
                    "CustomerAccount.family.is_(None))",
        viewonly=True,
    )
    accounts: Mapped[list[CustomerAccount]] = relationship(
        back_populates="customer",
        primaryjoin="Customer.id == CustomerAccount.customer_id",
        viewonly=True,
    )


class CustomerAccount(Base):
    __tablename__ = "customer_account"
    __table_args__ = (
        UniqueConstraint("customer_id", "family", name="uq_customer_account_family"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    customer_id: Mapped[int] = mapped_column(
        ForeignKey("customer.id"), nullable=False, index=True
    )
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id"), nullable=False)
    family: Mapped[str | None] = mapped_column(String(40), nullable=True)
    commission_pct: Mapped[object | None] = mapped_column(PCT, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    customer: Mapped[Customer] = relationship(
        back_populates="accounts",
        primaryjoin="Customer.id == CustomerAccount.customer_id",
        viewonly=True,
    )
    account: Mapped[object] = relationship("Account")


MERGED_MARK = "(مدموج في #"


class CustomerExternalRef(Base):
    __tablename__ = "customer_external_ref"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    system: Mapped[str] = mapped_column(String(16), nullable=False, default="erp")
    ref: Mapped[str] = mapped_column(String(60), unique=True, nullable=False, index=True)
    customer_id: Mapped[int] = mapped_column(
        ForeignKey("customer.id"), nullable=False, index=True)
    source_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
