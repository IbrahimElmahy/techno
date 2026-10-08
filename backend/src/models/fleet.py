from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import (
    Boolean, Date, DateTime, Enum, ForeignKey, Integer, String, UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK
from src.core.money import MONEY, QTY


def _enum(e):
    return Enum(e, native_enum=False, length=20)


class VehicleStatus(str, enum.Enum):
    good = "good"
    attention = "attention"
    maintenance_due = "maintenance_due"
    stopped = "stopped"


class DriverRating(str, enum.Enum):
    excellent = "excellent"
    very_good = "very_good"
    good = "good"
    needs_followup = "needs_followup"


class DriverStatus(str, enum.Enum):
    active = "active"
    on_leave = "on_leave"
    suspended = "suspended"


class FaultSeverity(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class FaultStatus(str, enum.Enum):
    open = "open"
    in_repair = "in_repair"
    resolved = "resolved"


class CheckResult(str, enum.Enum):
    ok = "ok"
    attention = "attention"
    bad = "bad"


class TaskPeriod(str, enum.Enum):
    daily = "daily"
    immediate = "immediate"
    weekly = "weekly"
    monthly = "monthly"


class _Audit:

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)


class Vehicle(_Audit, Base):

    __tablename__ = "fleet_vehicle"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True,
                                                  index=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    kind: Mapped[str | None] = mapped_column(String(80), nullable=True)
    model: Mapped[str | None] = mapped_column(String(80), nullable=True)
    plate_number: Mapped[str | None] = mapped_column(String(40), nullable=True)
    current_driver_id: Mapped[int | None] = mapped_column(
        ForeignKey("employee.id"), nullable=True, index=True)
    odometer_base: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    odometer: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[VehicleStatus] = mapped_column(
        _enum(VehicleStatus), default=VehicleStatus.good, nullable=False, index=True)
    status_override: Mapped[VehicleStatus | None] = mapped_column(
        _enum(VehicleStatus), nullable=True)
    last_maintenance_km: Mapped[int | None] = mapped_column(Integer, nullable=True)
    next_maintenance_km: Mapped[int | None] = mapped_column(Integer, nullable=True)
    insurance_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    license_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    fuel_account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"), nullable=True)
    maintenance_account_id: Mapped[int | None] = mapped_column(
        ForeignKey("account.id"), nullable=True)
    cost_center_id: Mapped[int | None] = mapped_column(ForeignKey("cost_center.id"),
                                                       nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)


class VehicleDriverAssignment(_Audit, Base):

    __tablename__ = "fleet_vehicle_driver"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True,
                                                  index=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("fleet_vehicle.id"), nullable=False,
                                            index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employee.id"), nullable=False,
                                             index=True)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    start_odometer: Mapped[int | None] = mapped_column(Integer, nullable=True)
    end_odometer: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes: Mapped[str | None] = mapped_column(String(300), nullable=True)


class DriverProfile(_Audit, Base):

    __tablename__ = "fleet_driver_profile"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employee.id"), unique=True,
                                             nullable=False)
    rating: Mapped[DriverRating | None] = mapped_column(_enum(DriverRating), nullable=True)
    status: Mapped[DriverStatus] = mapped_column(
        _enum(DriverStatus), default=DriverStatus.active, nullable=False)
    license_number: Mapped[str | None] = mapped_column(String(40), nullable=True)
    license_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)


class _VehicleRecord(_Audit):

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True,
                                                  index=True)
    record_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("fleet_vehicle.id"), nullable=False,
                                            index=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)


class VehicleMaintenance(_VehicleRecord, Base):
    __tablename__ = "fleet_maintenance"

    odometer: Mapped[int | None] = mapped_column(Integer, nullable=True)
    kind: Mapped[str | None] = mapped_column(String(80), nullable=True)
    work_done: Mapped[str | None] = mapped_column(String(500), nullable=True)
    parts: Mapped[str | None] = mapped_column(String(500), nullable=True)
    cost: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    workshop: Mapped[str | None] = mapped_column(String(160), nullable=True)
    next_maintenance_km: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fault_id: Mapped[int | None] = mapped_column(ForeignKey("fleet_fault.id"), nullable=True)
    voucher_id: Mapped[int | None] = mapped_column(ForeignKey("voucher.id"), nullable=True)


class VehicleFuel(_VehicleRecord, Base):
    __tablename__ = "fleet_fuel"

    driver_id: Mapped[int | None] = mapped_column(ForeignKey("employee.id"), nullable=True,
                                                  index=True)
    odometer: Mapped[int | None] = mapped_column(Integer, nullable=True)
    liters: Mapped[object] = mapped_column(QTY, default=0, nullable=False)
    amount: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    station: Mapped[str | None] = mapped_column(String(160), nullable=True)
    route: Mapped[str | None] = mapped_column(String(240), nullable=True)
    voucher_id: Mapped[int | None] = mapped_column(ForeignKey("voucher.id"), nullable=True)


class VehicleFault(_VehicleRecord, Base):
    __tablename__ = "fleet_fault"

    driver_id: Mapped[int | None] = mapped_column(ForeignKey("employee.id"), nullable=True,
                                                  index=True)
    odometer: Mapped[int | None] = mapped_column(Integer, nullable=True)
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    severity: Mapped[FaultSeverity] = mapped_column(
        _enum(FaultSeverity), default=FaultSeverity.medium, nullable=False)
    action_required: Mapped[str | None] = mapped_column(String(300), nullable=True)
    stopped: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    downtime_days: Mapped[object | None] = mapped_column(QTY, nullable=True)
    status: Mapped[FaultStatus] = mapped_column(
        _enum(FaultStatus), default=FaultStatus.open, nullable=False, index=True)
    resolved_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    cost: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    is_accident: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    voucher_id: Mapped[int | None] = mapped_column(ForeignKey("voucher.id"), nullable=True)


class VehicleViolation(_VehicleRecord, Base):
    __tablename__ = "fleet_violation"

    driver_id: Mapped[int | None] = mapped_column(ForeignKey("employee.id"), nullable=True,
                                                  index=True)
    kind: Mapped[str | None] = mapped_column(String(80), nullable=True)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    amount: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    paid: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    paid_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    admin_action: Mapped[str | None] = mapped_column(String(300), nullable=True)
    voucher_id: Mapped[int | None] = mapped_column(ForeignKey("voucher.id"), nullable=True)
    penalty_adjustment_id: Mapped[int | None] = mapped_column(
        ForeignKey("payroll_adjustment.id"), nullable=True)


class VehicleInspection(_VehicleRecord, Base):

    __tablename__ = "fleet_inspection"
    __table_args__ = (UniqueConstraint("vehicle_id", "record_date",
                                       name="uq_fleet_inspection_day"),)

    driver_id: Mapped[int | None] = mapped_column(ForeignKey("employee.id"), nullable=True)
    odometer: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fuel: Mapped[CheckResult | None] = mapped_column(_enum(CheckResult), nullable=True)
    oil_water: Mapped[CheckResult | None] = mapped_column(_enum(CheckResult), nullable=True)
    tires: Mapped[CheckResult | None] = mapped_column(_enum(CheckResult), nullable=True)
    brakes: Mapped[CheckResult | None] = mapped_column(_enum(CheckResult), nullable=True)
    lights: Mapped[CheckResult | None] = mapped_column(_enum(CheckResult), nullable=True)
    cleanliness: Mapped[CheckResult | None] = mapped_column(_enum(CheckResult), nullable=True)
    damages: Mapped[str | None] = mapped_column(String(500), nullable=True)
    driver_signed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    approved_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class FleetMonthlyNote(_Audit, Base):

    __tablename__ = "fleet_monthly_note"
    __table_args__ = (UniqueConstraint("vehicle_id", "year", "month",
                                       name="uq_fleet_monthly_note"),)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("fleet_vehicle.id"), nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)


class FleetTask(_Audit, Base):

    __tablename__ = "fleet_task"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True,
                                                  index=True)
    period: Mapped[TaskPeriod] = mapped_column(_enum(TaskPeriod), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    details: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class FleetTaskLog(Base):

    __tablename__ = "fleet_task_log"
    __table_args__ = (UniqueConstraint("task_id", "branch_key", "period_key",
                                       name="uq_fleet_task_log"),)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("fleet_task.id"), nullable=False, index=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True,
                                                  index=True)
    branch_key: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    period_key: Mapped[str] = mapped_column(String(12), nullable=False)
    done_date: Mapped[date] = mapped_column(Date, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(300), nullable=True)
    done_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False)


class FleetSetting(Base):

    __tablename__ = "fleet_setting"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    expiry_alert_days: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    maintenance_alert_km: Mapped[int] = mapped_column(Integer, default=500, nullable=False)
    fuel_abnormal_pct: Mapped[int] = mapped_column(Integer, default=20, nullable=False)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
