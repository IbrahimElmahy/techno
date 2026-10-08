from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import (
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK
from src.core.money import MONEY, QTY


class AdvanceStatus(str, enum.Enum):
    active = "active"
    settled = "settled"
    cancelled = "cancelled"


class EmployeeAdvance(Base):
    __tablename__ = "employee_advance"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employee.id"), nullable=False, index=True
    )
    advance_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    instalments: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    instalment_amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    start_year: Mapped[int] = mapped_column(Integer, nullable=False)
    start_month: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    status: Mapped[AdvanceStatus] = mapped_column(
        Enum(AdvanceStatus, native_enum=False, length=12),
        default=AdvanceStatus.active, nullable=False, index=True,
    )
    ledger_entry_id: Mapped[int | None] = mapped_column(
        ForeignKey("ledger_entry.id"), nullable=True
    )
    reversal_entry_id: Mapped[int | None] = mapped_column(
        ForeignKey("ledger_entry.id"), nullable=True
    )
    treasury_id: Mapped[int | None] = mapped_column(ForeignKey("treasury.id"), nullable=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True)
    cost_center_id: Mapped[int | None] = mapped_column(
        ForeignKey("cost_center.id"), nullable=True
    )
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class EmployeeAdvanceInstalment(Base):
    __tablename__ = "employee_advance_instalment"
    __table_args__ = (
        UniqueConstraint("advance_id", "year", "month", name="uq_advance_instalment_period"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    advance_id: Mapped[int] = mapped_column(
        ForeignKey("employee_advance.id"), nullable=False, index=True
    )
    year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    month: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    payroll_line_id: Mapped[int | None] = mapped_column(BigIntPK, nullable=True)


class AdjustmentKind(str, enum.Enum):
    penalty = "penalty"
    bonus = "bonus"
    other_deduction = "other_deduction"
    other_earning = "other_earning"


class AdjustmentBasis(str, enum.Enum):
    amount = "amount"
    days = "days"
    hours = "hours"


class AdjustmentStatus(str, enum.Enum):
    draft = "draft"
    approved = "approved"
    cancelled = "cancelled"


class PayrollAdjustment(Base):
    __tablename__ = "payroll_adjustment"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employee.id"), nullable=False, index=True
    )
    kind: Mapped[AdjustmentKind] = mapped_column(
        Enum(AdjustmentKind, native_enum=False, length=16), nullable=False
    )
    basis: Mapped[AdjustmentBasis] = mapped_column(
        Enum(AdjustmentBasis, native_enum=False, length=8),
        default=AdjustmentBasis.amount, nullable=False,
    )
    quantity: Mapped[object | None] = mapped_column(QTY, nullable=True)
    amount: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    month: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    status: Mapped[AdjustmentStatus] = mapped_column(
        Enum(AdjustmentStatus, native_enum=False, length=12),
        default=AdjustmentStatus.approved, nullable=False, index=True,
    )
    approved_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    payroll_line_id: Mapped[int | None] = mapped_column(BigIntPK, nullable=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
