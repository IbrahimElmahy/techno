from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from src.core.money import ZERO, to_money


@dataclass(frozen=True)
class Bracket:
    from_amount: Decimal
    to_amount: Decimal | None
    rate_pct: Decimal
    fixed_amount: Decimal = ZERO


def _d(value) -> Decimal:
    return value if isinstance(value, Decimal) else Decimal(str(value or 0))


def tax_for(taxable: Decimal | str | int, brackets: list[Bracket],
            exemption: Decimal | str | int = 0) -> Decimal:
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
    rate = _d(hourly)
    normal = _d(hours_normal) * rate * _d(normal_pct) / Decimal("100")
    holiday = _d(hours_holiday) * rate * _d(holiday_pct) / Decimal("100")
    return to_money(normal + holiday)


def absence_deduction(*, days_absent, daily) -> Decimal:
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
    return to_money(
        _d(gross) - _d(insurance_employee) - _d(tax) - _d(advances) - _d(other_deductions)
    )
