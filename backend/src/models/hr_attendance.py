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
    __tablename__ = "work_shift"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    start_time: Mapped[str] = mapped_column(String(5), nullable=False)
    end_time: Mapped[str] = mapped_column(String(5), nullable=False)
    break_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    grace_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    weekend_days: Mapped[str] = mapped_column(String(20), default="4,5", nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class EmployeeShiftAssignment(Base):
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
    __tablename__ = "holiday"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    holiday_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    paid: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class AttendanceStatus(str, enum.Enum):
    present = "present"
    absent = "absent"
    leave = "leave"
    holiday = "holiday"
    weekend = "weekend"
    mission = "mission"


class AttendanceSource(str, enum.Enum):
    manual = "manual"
    import_file = "import"
    generated = "generated"


class AttendanceImport(Base):
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
    shift_id: Mapped[int | None] = mapped_column(ForeignKey("work_shift.id"), nullable=True)
    source: Mapped[AttendanceSource] = mapped_column(
        Enum(AttendanceSource, native_enum=False, length=12),
        default=AttendanceSource.manual, nullable=False,
    )
    import_batch_id: Mapped[int | None] = mapped_column(
        ForeignKey("attendance_import.id"), nullable=True
    )
    locked_by_payroll_run_id: Mapped[int | None] = mapped_column(BigIntPK, nullable=True)
    notes: Mapped[str | None] = mapped_column(String(240), nullable=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
