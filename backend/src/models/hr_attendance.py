"""الحضور والانصراف — الورديات والعطلات وسجل اليوم (HR-2).

The grain is **one employee, one day** — not one punch. A fingerprint device emits a stream of
punches and the same person can appear on it four times before lunch; what payroll, the late
report and the absence report all need is the day: was he here, from when, how late, how much over.
Keeping punches raw and deriving the day at read time means every one of those reports re-derives
it, and they drift.

`UniqueConstraint(employee_id, work_date)` is what makes the import safe to run twice — the same
export file, or an overlapping range, updates the day instead of adding a second one. That is the
same idempotency `fixed_asset_service.run_depreciation` gets from `(asset, year, month)`.

`shift_id` is **frozen onto the row** at the moment it is recorded. Changing somebody's shift in
March must not silently re-judge whether he was late in February.

`locked_by_payroll_run_id` is the one-way door: once a month has been posted to the ledger, the
days it was computed from stop being editable. The ledger entry cannot be edited either — that is
the point — so a day that could still move underneath it would leave the books resting on a figure
with no source.
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


class WorkShift(Base):
    """الوردية — مواعيد الشغل المتوقعة."""

    __tablename__ = "work_shift"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    # `HH:MM` نص، مش `Time`. The canonical form belongs on a settings screen that can be strict;
    # `Employee.work_start` stays the lenient free-text note it always was («٨ ص»، «٨:٣٠-٤»).
    start_time: Mapped[str] = mapped_column(String(5), nullable=False)
    end_time: Mapped[str] = mapped_column(String(5), nullable=False)
    break_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # سماح الدخول — الدقايق اللي مابتتحسبش تأخير.
    grace_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # أيام الراحة كأرقام ISO مفصولة بفاصلة («4,5» = الجمعة والسبت). CSV مش مصفوفة عشان
    # يشتغل على sqlite و MySQL و Postgres من غير نوع خاص بقاعدة.
    weekend_days: Mapped[str] = mapped_column(String(20), default="4,5", nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class EmployeeShiftAssignment(Base):
    """وردية موظف من تاريخ — بنسخ زمنية، فتغيير الوردية مابيعيدش الحكم على الشهر اللي فات."""

    __tablename__ = "employee_shift_assignment"
    __table_args__ = (
        UniqueConstraint("employee_id", "effective_from", name="uq_shift_assignment_period"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employee.id"), nullable=False, index=True
    )
    shift_id: Mapped[int] = mapped_column(ForeignKey("work_shift.id"), nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class Holiday(Base):
    """الأجازات الرسمية — من غيرها العيد بيتحسب غياب لكل الشركة."""

    __tablename__ = "holiday"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    holiday_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    paid: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # NULL = كل الفروع. A branch-specific closure is a real thing (a local feast, a building
    # shut for works) and forcing it company-wide would mark everyone else absent.
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class AttendanceStatus(str, enum.Enum):
    present = "present"      # حاضر
    absent = "absent"        # غايب
    leave = "leave"          # أجازة
    holiday = "holiday"      # عطلة رسمية
    weekend = "weekend"      # راحة أسبوعية
    mission = "mission"      # مأمورية


class AttendanceSource(str, enum.Enum):
    manual = "manual"        # مكتوب بالإيد
    import_file = "import"   # من ملف جهاز البصمة
    generated = "generated"  # النظام حطّه (عطلة/راحة)


class AttendanceImport(Base):
    """دفعة استيراد من جهاز البصمة — عشان «الملف ده عمل إيه» يبقى ليها إجابة."""

    __tablename__ = "attendance_import"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    date_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    date_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    rows_total: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    rows_created: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    rows_updated: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    rows_skipped: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class AttendanceDay(Base):
    """يوم واحد لموظف واحد."""

    __tablename__ = "attendance_day"
    __table_args__ = (
        UniqueConstraint("employee_id", "work_date", name="uq_attendance_employee_day"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employee.id"), nullable=False, index=True
    )
    work_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    status: Mapped[AttendanceStatus] = mapped_column(
        Enum(AttendanceStatus, native_enum=False, length=16),
        default=AttendanceStatus.present, nullable=False,
    )
    check_in: Mapped[str | None] = mapped_column(String(5), nullable=True)
    check_out: Mapped[str | None] = mapped_column(String(5), nullable=True)
    late_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    early_leave_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    worked_hours: Mapped[object] = mapped_column(QTY, default=0, nullable=False)
    overtime_hours: Mapped[object] = mapped_column(QTY, default=0, nullable=False)
    # الوردية زي ما كانت وقت التسجيل — تغييرها بعدين مايعيدش الحكم على الشهر اللي فات.
    shift_id: Mapped[int | None] = mapped_column(ForeignKey("work_shift.id"), nullable=True)
    source: Mapped[AttendanceSource] = mapped_column(
        Enum(AttendanceSource, native_enum=False, length=12),
        default=AttendanceSource.manual, nullable=False,
    )
    import_batch_id: Mapped[int | None] = mapped_column(
        ForeignKey("attendance_import.id"), nullable=True
    )
    # اليوم اللي داخل مسير مرحّل مابيتعدّلش. NULL = لسه مفتوح.
    locked_by_payroll_run_id: Mapped[int | None] = mapped_column(BigIntPK, nullable=True)
    notes: Mapped[str | None] = mapped_column(String(240), nullable=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
