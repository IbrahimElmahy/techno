"""السلف والجزاءات والمكافآت (HR-5).

**السلفة أصل، مش مصروف.** Booking an advance as an expense is the most common payroll-accounting
mistake there is: the money leaves the safe, so it looks like a cost — but the employee owes it
back, and the salary that later repays it is ALSO booked as a cost. The company would carry the
same pound twice. It is a receivable, and the payroll credits it away instalment by instalment.

**والجزاء والمكافأة في جدول واحد.** They are the same shape with the opposite sign — an amount
against an employee for a stated month with a reason on it — and `trade_reports.py` is built on the
same insight about sales and purchases. Two tables would be two sets of the same reports.

`basis` exists because a جزاء in this country is very often «خصم يومين», not a pound figure. The
days are turned into money at the daily rate of the month it lands in, which is not the same number
in a month somebody was on unpaid leave.
"""
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
    active = "active"        # لسه بيتقسّط
    settled = "settled"      # اتسدّد بالكامل
    cancelled = "cancelled"  # اتلغى قبل ما يتخصم منه حاجة


class EmployeeAdvance(Base):
    """سلفة — بتتصرف مرة وبتترد على أقساط."""

    __tablename__ = "employee_advance"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employee.id"), nullable=False, index=True
    )
    advance_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    instalments: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    # القسط متخزّن مش محسوب: قسمة ١٠٠٠ على ٣ بتدوّر، والتدوير لازم يتجمّد وقت الاتفاق عشان
    # المجموع يفضل ١٠٠٠ مهما اتقرا امتى.
    instalment_amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    start_year: Mapped[int] = mapped_column(Integer, nullable=False)
    start_month: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    status: Mapped[AdvanceStatus] = mapped_column(
        Enum(AdvanceStatus, native_enum=False, length=12),
        default=AdvanceStatus.active, nullable=False, index=True,
    )
    # قيد الصرف: مدين سلف العاملين / دائن الخزنة.
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
    """قسط شهر واحد من سلفة.

    `payroll_line_id` فاضي = القسط لسه مااتخصمش. المتبقي من السلفة **مشتق**: المبلغ ناقص مجموع
    الأقساط اللي اتخصمت فعلاً — نفس سبب الرصيد المشتق في الأجازات، عمود «متبقي» مخزّن بيفرق أول
    ما مسير يتعكس.
    """

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
    penalty = "penalty"                  # جزاء
    bonus = "bonus"                      # مكافأة
    other_deduction = "other_deduction"  # استقطاع آخر
    other_earning = "other_earning"      # استحقاق آخر


class AdjustmentBasis(str, enum.Enum):
    amount = "amount"
    days = "days"
    hours = "hours"


class AdjustmentStatus(str, enum.Enum):
    draft = "draft"
    approved = "approved"
    cancelled = "cancelled"


class PayrollAdjustment(Base):
    """جزاء أو مكافأة على شهر بعينه."""

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
    # بالأيام أو بالساعات — والمبلغ بيتحسب وقت المسير بأجر اليوم بتاع الشهر ده.
    quantity: Mapped[object | None] = mapped_column(QTY, nullable=True)
    amount: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    # الشهر اللي بينزل فيه. تسميته صراحةً هي اللي بتخلّي جزاء اتكتب يوم ٣ عن واقعة الشهر اللي
    # فات ينزل في المسير المفتوح بدل ما يضيع.
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
