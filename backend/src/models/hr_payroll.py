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
from src.core.money import MONEY, PCT, QTY


class ComponentKind(str, enum.Enum):
    earning = "earning"
    deduction = "deduction"


class ComponentCalc(str, enum.Enum):
    fixed = "fixed"
    percent_of_basic = "percent_of_basic"
    per_day = "per_day"
    per_hour = "per_hour"


class SalaryComponent(Base):
    __tablename__ = "salary_component"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    kind: Mapped[ComponentKind] = mapped_column(
        Enum(ComponentKind, native_enum=False, length=12), nullable=False
    )
    calc: Mapped[ComponentCalc] = mapped_column(
        Enum(ComponentCalc, native_enum=False, length=20),
        default=ComponentCalc.fixed, nullable=False,
    )
    taxable: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    insurable: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class PayMethod(str, enum.Enum):
    cash = "cash"
    bank = "bank"
    wallet = "wallet"


class EmployeeSalary(Base):
    __tablename__ = "employee_salary"
    __table_args__ = (
        UniqueConstraint("employee_id", "effective_from", name="uq_employee_salary_period"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employee.id"), nullable=False, index=True
    )
    effective_from: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    basic: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    payment_method: Mapped[PayMethod] = mapped_column(
        Enum(PayMethod, native_enum=False, length=12), default=PayMethod.cash, nullable=False
    )
    bank_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    bank_account: Mapped[str | None] = mapped_column(String(64), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(300), nullable=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class EmployeeSalaryLine(Base):
    __tablename__ = "employee_salary_line"
    __table_args__ = (
        UniqueConstraint("salary_id", "component_id", name="uq_salary_line_component"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    salary_id: Mapped[int] = mapped_column(
        ForeignKey("employee_salary.id"), nullable=False, index=True
    )
    component_id: Mapped[int] = mapped_column(
        ForeignKey("salary_component.id"), nullable=False
    )
    amount: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    pct: Mapped[object | None] = mapped_column(PCT, nullable=True)
    notes: Mapped[str | None] = mapped_column(String(240), nullable=True)


class AbsenceBasis(str, enum.Enum):
    basic = "basic"
    gross = "gross"


class LatePolicy(str, enum.Enum):
    none = "none"
    minutes_to_days = "minutes_to_days"
    fixed_per_minute = "fixed_per_minute"


class PayrollSetting(Base):
    __tablename__ = "payroll_setting"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    days_per_month: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    hours_per_day: Mapped[object] = mapped_column(QTY, default=8, nullable=False)
    overtime_normal_pct: Mapped[object] = mapped_column(PCT, default=135, nullable=False)
    overtime_holiday_pct: Mapped[object] = mapped_column(PCT, default=200, nullable=False)
    absence_basis: Mapped[AbsenceBasis] = mapped_column(
        Enum(AbsenceBasis, native_enum=False, length=8), default=AbsenceBasis.gross, nullable=False
    )
    late_policy: Mapped[LatePolicy] = mapped_column(
        Enum(LatePolicy, native_enum=False, length=20), default=LatePolicy.none, nullable=False
    )
    late_grace_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    late_rate: Mapped[object | None] = mapped_column(MONEY, nullable=True)
    include_commission: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class EmployeeInsurance(Base):
    __tablename__ = "employee_insurance"
    __table_args__ = (
        UniqueConstraint("employee_id", "effective_from", name="uq_employee_insurance_period"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employee.id"), nullable=False, index=True
    )
    effective_from: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    amount: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(300), nullable=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
