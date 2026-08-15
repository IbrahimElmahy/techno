"""حساب المرتب — دوال نقية، من غير قاعدة بيانات (HR-4).

Same shape as `src/lib/depreciation.py` and `src/lib/attendance_calc.py`: no session in any
signature, so every figure here can be tested against a table somebody can check by hand.

The brackets are passed IN. Nothing about Egyptian tax law is written into this file — the rates
live in `payroll_scheme_version` where the client's accountant maintains them, and the payroll run
stamps the version it used so recomputing an old month uses the rates that were in force then.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from src.core.money import ZERO, to_money


@dataclass(frozen=True)
class Bracket:
    """شريحة واحدة. `to_amount = None` يعني «وما زاد»."""

    from_amount: Decimal
    to_amount: Decimal | None
    rate_pct: Decimal
    fixed_amount: Decimal = ZERO


def _d(value) -> Decimal:
    return value if isinstance(value, Decimal) else Decimal(str(value or 0))


def tax_for(taxable: Decimal | str | int, brackets: list[Bracket],
            exemption: Decimal | str | int = 0) -> Decimal:
    """الضريبة على وعاء سنوي بشرايح تصاعدية.

    Progressive, not flat: each slice of income is taxed at its own band's rate, so somebody who
    crosses into a higher band pays the higher rate on the excess ONLY. Applying the top rate to
    the whole amount is the classic mistake, and the shape of it is that a raise can leave somebody
    worse off — which is how it gets noticed, by an employee, angrily.

    `exemption` comes off before any band applies, and never makes the tax negative.
    """
    base = _d(taxable) - _d(exemption)
    if base <= 0 or not brackets:
        return ZERO

    total = ZERO
    for band in sorted(brackets, key=lambda b: _d(b.from_amount)):
        lower = _d(band.from_amount)
        if base <= lower:
            break
        upper = _d(band.to_amount) if band.to_amount is not None else base
        slice_top = min(base, upper)
        width = slice_top - lower
        if width <= 0:
            continue
        total += width * _d(band.rate_pct) / Decimal("100")
        total += _d(band.fixed_amount)
    return to_money(total)


def insurance_for(
    base: Decimal | str | int,
    *,
    employee_pct,
    employer_pct,
    min_base=None,
    max_base=None,
) -> tuple[Decimal, Decimal]:
    """حصة الموظف وحصة الشركة في التأمينات.

    The floor and the ceiling are the point of the function. Egyptian social insurance is charged
    on a base clamped between a minimum and a maximum wage, so somebody on a very high salary pays
    on the ceiling and not on what he earns. Ignoring the ceiling over-deducts every senior
    employee, every month, by an amount nobody notices until the authority reconciles.
    """
    amount = _d(base)
    if min_base is not None:
        amount = max(amount, _d(min_base))
    if max_base is not None:
        amount = min(amount, _d(max_base))
    if amount <= 0:
        return ZERO, ZERO
    employee = to_money(amount * _d(employee_pct) / Decimal("100"))
    employer = to_money(amount * _d(employer_pct) / Decimal("100"))
    return employee, employer


def daily_rate(monthly: Decimal | str | int, days_per_month: int = 30) -> Decimal:
    """أجر اليوم. صفر أيام مابيرميش قسمة على صفر — بيرجّع صفر."""
    if not days_per_month or days_per_month <= 0:
        return ZERO
    return to_money(_d(monthly) / Decimal(days_per_month))


def hourly_rate(monthly, days_per_month: int = 30, hours_per_day=8) -> Decimal:
    hours = _d(hours_per_day)
    if hours <= 0:
        return ZERO
    return to_money(daily_rate(monthly, days_per_month) / hours)


def overtime_amount(
    *, hours_normal=0, hours_holiday=0, hourly, normal_pct=135, holiday_pct=200,
) -> Decimal:
    """قيمة الإضافي. العادي والعطلة بنسبتين مختلفتين — ده اللي القانون بيقوله."""
    rate = _d(hourly)
    normal = _d(hours_normal) * rate * _d(normal_pct) / Decimal("100")
    holiday = _d(hours_holiday) * rate * _d(holiday_pct) / Decimal("100")
    return to_money(normal + holiday)


def absence_deduction(*, days_absent, daily) -> Decimal:
    """خصم الغياب. مابيبقاش سالب مهما اتبعت إيه."""
    days = _d(days_absent)
    if days <= 0:
        return ZERO
    return to_money(days * _d(daily))


def net_of(
    *,
    gross,
    insurance_employee=0,
    tax=0,
    advances=0,
    other_deductions=0,
) -> Decimal:
    """الصافي = الإجمالي − الاستقطاعات.

    Allowed to go negative and NOT clamped, on purpose. Somebody whose deductions exceed his pay
    this month is a real situation — a big advance instalment against a month of unpaid leave — and
    it is one a human has to look at. Clamping it to zero would hide the case and quietly forgive
    the difference, which is a decision the software does not get to make.
    """
    return to_money(
        _d(gross) - _d(insurance_employee) - _d(tax) - _d(advances) - _d(other_deductions)
    )
