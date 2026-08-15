"""الأجازات — الأنواع والأرصدة والطلبات (HR-3).

**الرصيد المستهلك مشتق، مش مخزّن.** `leave_entitlement` holds what somebody is owed — the opening
balance and the year's entitlement — and never how much has been taken. That is summed from the
approved requests every time it is asked for.

Storing `used` alongside them reads as an obvious optimisation and drifts the first time a request
is cancelled, or edited, or approved twice by two people on two screens. Then the balance on the
card disagrees with the requests underneath it and nobody can tell which one is lying. Principle VI
in this codebase — a balance is derived from its movements — for the same reason the ledger works
that way.

Approving a request WRITES attendance days with `status=leave`. Payroll then reads one thing, and
«ليه محسوبه غايب وهو كان في أجازة» has no way to happen.
"""
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
    """نوع الأجازة — سنوية، عارضة، مرضية، بدون أجر…"""

    __tablename__ = "leave_type"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    # الرصيد السنوي الافتراضي — ممكن يتعدّل لموظف بعينه في `leave_entitlement`.
    annual_quota: Mapped[object] = mapped_column(QTY, default=0, nullable=False)
    # «مدفوعة» و«بتخصم من المرتب» مش عكس بعض: أجازة بدون أجر مش مدفوعة وبتخصم؛ أجازة مرضية
    # ممكن تكون مدفوعة ومابتخصمش من رصيد السنوية.
    paid: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    deducts_salary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    affects_balance: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    requires_approval: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # هل الجمعة والسبت بيتحسبوا جوه الأجازة؟ «أسبوع» يعني سبعة، «خمس أيام شغل» يعني خمسة.
    counts_weekend: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    carry_over_max: Mapped[object | None] = mapped_column(QTY, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class LeaveEntitlement(Base):
    """المستحق للموظف في السنة — المرحّل والمستحق والتعديل اليدوي.

    **مافيش عمود `used`.** بيتجمّع من الطلبات المعتمدة وقت السؤال — راجع شرح الملف.
    """

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
    # المرحّل من السنة اللي فاتت.
    opening: Mapped[object] = mapped_column(QTY, default=0, nullable=False)
    entitled: Mapped[object] = mapped_column(QTY, default=0, nullable=False)
    # تسوية بالموجب أو بالسالب — منحة أو خصم إداري، بسببها مكتوب.
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
    """طلب أجازة — بيتلغي، مابيتمسحش."""

    __tablename__ = "leave_request"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employee.id"), nullable=False, index=True
    )
    leave_type_id: Mapped[int] = mapped_column(ForeignKey("leave_type.id"), nullable=False)
    date_from: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    date_to: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    # الأيام محسوبة وقت الحفظ ومتخزّنة: عدد أيام الشغل جوه المدى بيتغيّر لو العطلات اتعدّلت
    # بعدين، وأجازة اتوافق عليها بستة أيام لازم تفضل ستة.
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
