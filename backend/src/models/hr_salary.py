from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK
from src.core.money import MONEY, PCT


class CommissionBasis(str, enum.Enum):
    sales = "sales"
    collections = "collections"
    pool = "pool"


class EmployeeCommissionRule(Base):
    __tablename__ = "employee_commission_rule"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employee.id"), nullable=False, index=True
    )
    basis: Mapped[CommissionBasis] = mapped_column(
        Enum(CommissionBasis, native_enum=False, length=16), nullable=False
    )
    pct: Mapped[object] = mapped_column(PCT, nullable=False)
    white_pct: Mapped[object | None] = mapped_column(PCT, nullable=True)
    pools: Mapped[str | None] = mapped_column(String(200), nullable=True)
    split: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(200), nullable=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class CommissionPool(Base):
    __tablename__ = "commission_pool"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    branch_id: Mapped[int] = mapped_column(ForeignKey("branch.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    rep_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class CommissionPoolAmount(Base):
    __tablename__ = "commission_pool_amount"
    __table_args__ = (
        UniqueConstraint("pool_id", "year", "month", name="uq_commission_pool_month"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    pool_id: Mapped[int] = mapped_column(
        ForeignKey("commission_pool.id"), nullable=False, index=True
    )
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    poly: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    white: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    manual: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )
