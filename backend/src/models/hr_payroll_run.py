"""مسير الرواتب — التشغيل والسطور والتفاصيل (HR-6).

**`reversal_seq` هي اللي بتخلّي الشهر يتعمل مرة واحدة ويفضل ليه تاريخ.**

`UniqueConstraint(year, month, branch_id, reversal_seq)` — the database itself refuses a second
run for the same month, so «الترحيل مرتين» cannot happen even if two people press at once. And
reversing bumps the seq rather than deleting the row, which is where this differs from
`fixed_asset_service.reverse_depreciation`: that one DELETES its period markers, which is right for
a marker and wrong for a document. A payroll run has a printed number and an employee is holding a
payslip that quotes it — erasing it would make the paper in his hand refer to nothing.

**والسطر بيتجمّد.** `department_id`, `job_title_id`, `cost_center_id` are copied onto the line when
it is computed. Somebody who moves department in April must not change what March's payroll cost
the warehouse — the report would rewrite itself every time anybody transferred.

`payroll_line_detail` is one row per contributing figure. It is the reason «تقارير كتير جداً» over
payroll is cheap: every breakdown — by component, by kind, by employee, by department — is a
group-by over this one table rather than a new query per report.
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
from src.core.money import MONEY, QTY


class PayrollRunStatus(str, enum.Enum):
    draft = "draft"        # محسوب ومش مرحّل — بيتعاد حسابه براحتك
    posted = "posted"      # اترحّل للأستاذ
    reversed = "reversed"  # اتعكس، والشهر رجع مفتوح


class PayrollRun(Base):
    """مسير شهر واحد لفرع واحد."""

    __tablename__ = "payroll_run"
    __table_args__ = (
        UniqueConstraint("year", "month", "branch_id", "reversal_seq",
                         name="uq_payroll_run_period"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    month: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True)
    # بيزيد مع كل عكس، فإعادة الترحيل بتدخل من غير ما تصطدم بالقيد الفريد — والمسير القديم
    # بيفضل موجود برقمه، لأن حد ماسك قسيمة بتقول عليه.
    reversal_seq: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[PayrollRunStatus] = mapped_column(
        Enum(PayrollRunStatus, native_enum=False, length=12),
        default=PayrollRunStatus.draft, nullable=False, index=True,
    )
    # الإصدارات اللي اتحسب بيها — إعادة قراية شهر قديم بتستعمل شرايحه هو.
    tax_version_id: Mapped[int | None] = mapped_column(
        ForeignKey("payroll_scheme_version.id"), nullable=True
    )
    insurance_version_id: Mapped[int | None] = mapped_column(
        ForeignKey("payroll_scheme_version.id"), nullable=True
    )
    earnings: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    absence_deduction: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    overtime: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    bonuses: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    penalties: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    gross: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    insurance_employee: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    insurance_employer: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    tax: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    advances: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    other_deductions: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    total_deductions: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    net: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    accrual_entry_id: Mapped[int | None] = mapped_column(
        ForeignKey("ledger_entry.id"), nullable=True
    )
    reversal_entry_id: Mapped[int | None] = mapped_column(
        ForeignKey("ledger_entry.id"), nullable=True
    )
    posted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    posted_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class PayrollLine(Base):
    """سطر موظف واحد في مسير — كل أرقامه متجمّدة وقت الحساب."""

    __tablename__ = "payroll_line"
    __table_args__ = (
        UniqueConstraint("run_id", "employee_id", name="uq_payroll_line_employee"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("payroll_run.id"), nullable=False, index=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employee.id"), nullable=False, index=True
    )
    # متجمّدين: نقل موظف في أبريل مايغيّرش تكلفة مارس على المخزن.
    department_id: Mapped[int | None] = mapped_column(ForeignKey("department.id"), nullable=True)
    job_title_id: Mapped[int | None] = mapped_column(ForeignKey("job_title.id"), nullable=True)
    cost_center_id: Mapped[int | None] = mapped_column(
        ForeignKey("cost_center.id"), nullable=True
    )
    basic: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    allowances: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    overtime_hours: Mapped[object] = mapped_column(QTY, default=0, nullable=False)
    overtime_amount: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    gross: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    days_in_month: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    days_worked: Mapped[object] = mapped_column(QTY, default=0, nullable=False)
    days_absent: Mapped[object] = mapped_column(QTY, default=0, nullable=False)
    days_leave_paid: Mapped[object] = mapped_column(QTY, default=0, nullable=False)
    days_leave_unpaid: Mapped[object] = mapped_column(QTY, default=0, nullable=False)
    late_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    absence_deduction: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    penalty_amount: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    bonus_amount: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    insurance_base: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    insurance_employee: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    insurance_employer: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    taxable_base: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    tax_amount: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    advance_deduction: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    other_deductions: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    total_deductions: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    net: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    # موظف مالوش ولا يوم حضور مسجّل. مش غياب كامل — ده معناه إن محدش رفع الملف، والفرق بين
    # الاتنين هو الفرق بين مرتب كامل ومرتب صفر.
    has_attendance: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    paid: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    payment_entry_id: Mapped[int | None] = mapped_column(
        ForeignKey("ledger_entry.id"), nullable=True
    )
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class DetailSource(str, enum.Enum):
    component = "component"
    overtime = "overtime"
    absence = "absence"
    penalty = "penalty"
    bonus = "bonus"
    advance = "advance"
    insurance = "insurance"
    tax = "tax"


class DetailKind(str, enum.Enum):
    earning = "earning"
    deduction = "deduction"


class PayrollLineDetail(Base):
    """بند واحد على سطر — قسيمة الراتب بتتقرا من هنا، وكل تقارير المرتبات كمان."""

    __tablename__ = "payroll_line_detail"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    line_id: Mapped[int] = mapped_column(
        ForeignKey("payroll_line.id"), nullable=False, index=True
    )
    source: Mapped[DetailSource] = mapped_column(
        Enum(DetailSource, native_enum=False, length=16), nullable=False, index=True
    )
    component_id: Mapped[int | None] = mapped_column(
        ForeignKey("salary_component.id"), nullable=True
    )
    # رقم السلفة أو الجزاء اللي السطر ده جاي منه — عشان الرجوع للمستند.
    ref_id: Mapped[int | None] = mapped_column(BigIntPK, nullable=True)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[DetailKind] = mapped_column(
        Enum(DetailKind, native_enum=False, length=12), nullable=False
    )
    quantity: Mapped[object | None] = mapped_column(QTY, nullable=True)
    amount: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)


class PayrollRemittance(Base):
    """سداد التأمينات أو الضريبة للجهة — بيقفل الالتزام من الخزنة.

    من غيره الحسابات دي بتكبر للأبد: المسير بيرحّل عليها كل شهر ومحدش بيقفلها.
    """

    __tablename__ = "payroll_remittance"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # insurance | tax
    amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    remit_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    treasury_id: Mapped[int | None] = mapped_column(ForeignKey("treasury.id"), nullable=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True)
    ledger_entry_id: Mapped[int | None] = mapped_column(
        ForeignKey("ledger_entry.id"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(String(300), nullable=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
