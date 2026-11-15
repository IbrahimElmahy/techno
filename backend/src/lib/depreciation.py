from __future__ import annotations

import calendar
from datetime import date
from decimal import ROUND_CEILING, Decimal

from src.core.money import ZERO, to_money

METHODS = ("straight_line", "declining_balance", "declining_then_linear", "sum_of_years",
           "none")


def months_between(start: date, year: int, month: int) -> int:
    return (year - start.year) * 12 + (month - start.month)


def add_months(year: int, month: int, n: int) -> tuple[int, int]:
    idx = year * 12 + month - 1 + n
    return idx // 12, idx % 12 + 1


def life_from_rate(annual_rate) -> int | None:
    rate = Decimal(str(annual_rate or 0))
    if rate <= ZERO:
        return None
    return int((Decimal(1200) / rate).to_integral_value(rounding=ROUND_CEILING))


def first_month_fraction(start: date) -> Decimal:
    days = calendar.monthrange(start.year, start.month)[1]
    return Decimal(days - start.day + 1) / Decimal(days)


def monthly_amount(
    *,
    cost: Decimal,
    salvage_value: Decimal,
    useful_life_months: int | None,
    method: str,
    accumulated: Decimal,
    periods_elapsed: int,
    annual_rate=None,
    base_value=None,
    base_months: int | None = None,
    since_start: int = 0,
    fraction: Decimal | None = None,
) -> Decimal:
    cost = to_money(cost)
    salvage_value = to_money(salvage_value)
    accumulated = to_money(accumulated)
    rate = Decimal(str(annual_rate or 0))
    life = useful_life_months or life_from_rate(rate) or 0

    if method == "none" or periods_elapsed < 0 or since_start < 0:
        return ZERO

    depreciable = to_money(cost - salvage_value)
    remaining = to_money(depreciable - accumulated)
    if depreciable <= ZERO or remaining <= ZERO:
        return ZERO

    def linear() -> Decimal:
        if base_value is not None and base_months:
            return to_money(Decimal(base_value) / Decimal(base_months))
        if life:
            return to_money(depreciable / Decimal(life))
        if rate > ZERO:
            return to_money(depreciable * rate / Decimal(1200))
        return ZERO

    def declining() -> Decimal:
        yearly = rate / Decimal(100) if rate > ZERO else (
            Decimal(24) / Decimal(life) if life else ZERO)
        return to_money(to_money(cost - accumulated) * yearly / Decimal(12))

    if method == "declining_balance":
        raw = declining()
    elif method == "declining_then_linear":
        total = base_months or (life - periods_elapsed + since_start if life else 0)
        left = max((total or 0) - since_start, 1)
        raw = max(declining(), to_money(remaining / Decimal(left)))
    elif method == "sum_of_years":
        if not life:
            return ZERO
        years = (life + 11) // 12
        index = periods_elapsed // 12
        if index >= years:
            return remaining
        total = Decimal(years * (years + 1)) / Decimal(2)
        raw = to_money(depreciable * Decimal(years - index) / total / Decimal(12))
    else:
        raw = linear()

    if fraction is not None and raw > ZERO:
        raw = to_money(raw * fraction)
    if raw <= ZERO:
        return ZERO
    return remaining if raw > remaining else raw
