from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
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
from src.core.money import QTY


class LeaveType(Base):
    __tablename__ = "leave_type"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    annual_quota: Mapped[object] = mapped_column(QTY, default=0, nullable=False)
    paid: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    deducts_salary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    affects_balance: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    requires_approval: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    counts_weekend: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    carry_over_max: Mapped[object | None] = mapped_column(QTY, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class LeaveEntitlement(Base):
    __tablename__ = "leave_entitlement"
    __table_args__ = (
        UniqueConstraint("employee_id", "leave_type_id", "year", name="uq_entitlement_year"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employee.id"), nullable=False, index=True
    )
    leave_type_id: Mapped[int] = mapped_column(ForeignKey("leave_type.id"), nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    opening: Mapped[object] = mapped_column(QTY, default=0, nullable=False)
    entitled: Mapped[object] = mapped_column(QTY, default=0, nullable=False)
    adjustment: Mapped[object] = mapped_column(QTY, default=0, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(300), nullable=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class LeaveStatus(str, enum.Enum):
    draft = "draft"
    submitted = "submitted"
    approved = "approved"
    rejected = "rejected"
    cancelled = "cancelled"


class LeaveRequest(Base):
    __tablename__ = "leave_request"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employee.id"), nullable=False, index=True
    )
    leave_type_id: Mapped[int] = mapped_column(ForeignKey("leave_type.id"), nullable=False)
    date_from: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    date_to: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    days: Mapped[object] = mapped_column(QTY, default=0, nullable=False)
    reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    status: Mapped[LeaveStatus] = mapped_column(
        Enum(LeaveStatus, native_enum=False, length=12),
        default=LeaveStatus.submitted, nullable=False, index=True,
    )
    approved_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reject_reason: Mapped[str | None] = mapped_column(String(240), nullable=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
