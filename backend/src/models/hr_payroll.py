"""هيكل الرواتب وشرايح الضريبة والتأمينات (HR-4).

Two things here are versioned by date, and for the same reason: **a figure from last March has to
keep meaning what it meant last March.**

* `EmployeeSalary` — a raise in June must not rewrite May's payslip. So a salary is a row with an
  `effective_from`, and a raise is a new row, never an edit.
* `PayrollSchemeVersion` — the tax brackets and the insurance percentages. When the law changes,
  recomputing an old month with today's rates produces a number nobody can defend in front of the
  tax office. A version that has been used by a posted payroll is FROZEN; new rates are a new
  version with a new start date, always.

The brackets ship EMPTY. The first set is written by the client's accountant and confirmed by them.
Numbers invented here would travel into a payroll that posts to the ledger, and that is not a
responsibility this file can carry.

`SalaryComponent` is the catalogue of everything that is not basic pay — بدل انتقالات، بدل سكن،
حافز، خصم تأخير. `taxable` and `insurable` are separate flags because they genuinely differ: a
travel allowance can be outside the insurance base and inside the tax base.
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
from src.core.money import MONEY, PCT, QTY


class ComponentKind(str, enum.Enum):
    earning = "earning"      # استحقاق
    deduction = "deduction"  # استقطاع


class ComponentCalc(str, enum.Enum):
    fixed = "fixed"                        # مبلغ ثابت
    percent_of_basic = "percent_of_basic"  # نسبة من الأساسي
    per_day = "per_day"                    # باليوم
    per_hour = "per_hour"                  # بالساعة


class SalaryComponent(Base):
    """بند في الراتب غير الأساسي — بدل، حافز، خصم."""

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
    # الاتنين منفصلين عن قصد: بدل انتقالات ممكن يكون برّه الأجر التأميني وجوه وعاء الضريبة.
    taxable: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    insurable: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # حساب مصروف خاص بالبند — NULL يعني حساب المرتبات الرئيسي.
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
    """هيكل راتب الموظف من تاريخ — الزيادة صف جديد، مش تعديل."""

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
    # الأجر التأميني مش الأساسي بالضرورة — دي حاجة الشركة بتتفق عليها مع التأمينات.
    insurance_base: Mapped[object | None] = mapped_column(MONEY, nullable=True)
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
    """بند على هيكل راتب — مبلغ أو نسبة."""

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
    none = "none"                        # بيتسجّل ومابيتخصمش
    minutes_to_days = "minutes_to_days"  # الدقايق بتتحوّل جزء من يوم
    fixed_per_minute = "fixed_per_minute"


class PayrollSetting(Base):
    """إعدادات المسير — آخر صف هو الساري.

    `days_per_month` is the single most argued-about number in Egyptian payroll: thirty, or the
    actual days of that month. It is a setting rather than a constant because the answer differs
    per company and neither is wrong.
    """

    __tablename__ = "payroll_setting"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    days_per_month: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    hours_per_day: Mapped[object] = mapped_column(QTY, default=8, nullable=False)
    overtime_normal_pct: Mapped[object] = mapped_column(PCT, default=135, nullable=False)
    overtime_holiday_pct: Mapped[object] = mapped_column(PCT, default=200, nullable=False)
    absence_basis: Mapped[AbsenceBasis] = mapped_column(
        Enum(AbsenceBasis, native_enum=False, length=8), default=AbsenceBasis.gross, nullable=False
    )
    # الافتراضي «مابيتخصمش» عن قصد: خصم صامت على التأخير هو أسرع طريقة موديول مرتبات
    # يخسر ثقة الناس في أول شهر.
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


class SchemeKind(str, enum.Enum):
    income_tax = "income_tax"
    social_insurance = "social_insurance"


class PayrollSchemeVersion(Base):
    """إصدار شرايح — بيتجمّد أول ما مسير مرحّل يستعمله."""

    __tablename__ = "payroll_scheme_version"
    __table_args__ = (
        UniqueConstraint("scheme", "effective_from", name="uq_scheme_version_period"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    scheme: Mapped[SchemeKind] = mapped_column(
        Enum(SchemeKind, native_enum=False, length=20), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    # الإعفاء الشخصي السنوي، والشرايح بتتحسب على السنة وبعدين بتتقسّم على ١٢.
    annual_exemption: Mapped[object | None] = mapped_column(MONEY, nullable=True)
    annualise: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # التأمينات نسبة مسطحة، مش شرايح — الحصتين والحدين.
    employee_pct: Mapped[object | None] = mapped_column(PCT, nullable=True)
    employer_pct: Mapped[object | None] = mapped_column(PCT, nullable=True)
    min_base: Mapped[object | None] = mapped_column(MONEY, nullable=True)
    max_base: Mapped[object | None] = mapped_column(MONEY, nullable=True)
    # اتقفل لأن مسير مرحّل استعمله. التعديل بعدها = إعادة كتابة الماضي.
    locked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(300), nullable=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class PayrollSchemeBracket(Base):
    """شريحة — من مبلغ لمبلغ بنسبة. `to_amount` فاضي يعني «وما زاد»."""

    __tablename__ = "payroll_scheme_bracket"
    __table_args__ = (
        UniqueConstraint("version_id", "sequence", name="uq_scheme_bracket_order"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    version_id: Mapped[int] = mapped_column(
        ForeignKey("payroll_scheme_version.id"), nullable=False, index=True
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    from_amount: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    to_amount: Mapped[object | None] = mapped_column(MONEY, nullable=True)
    rate_pct: Mapped[object] = mapped_column(PCT, default=0, nullable=False)
    # بعض الجداول مكتوبة «X جنيه + Y٪ من الزايد».
    fixed_amount: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
