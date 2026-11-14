from __future__ import annotations

from datetime import date
from decimal import ROUND_CEILING, Decimal

from src.core.money import ZERO, to_money

METHODS = ("straight_line", "declining_balance", "sum_of_years", "none")


def months_between(start: date, year: int, month: int) -> int:
    return (year - start.year) * 12 + (month - start.month)


def life_from_rate(annual_rate) -> int | None:
    rate = Decimal(str(annual_rate or 0))
    if rate <= ZERO:
        return None
    return int((Decimal(1200) / rate).to_integral_value(rounding=ROUND_CEILING))


def monthly_amount(
    *,
    cost: Decimal,
    salvage_value: Decimal,
    useful_life_months: int | None,
    method: str,
    accumulated: Decimal,
    periods_elapsed: int,
    annual_rate=None,
) -> Decimal:
    cost = to_money(cost)
    salvage_value = to_money(salvage_value)
    accumulated = to_money(accumulated)
    rate = Decimal(str(annual_rate or 0))
    life = useful_life_months or life_from_rate(rate) or 0

    if method == "none" or periods_elapsed < 0:
        return ZERO

    depreciable = to_money(cost - salvage_value)
    remaining = to_money(depreciable - accumulated)
    if depreciable <= ZERO or remaining <= ZERO:
        return ZERO

    if method == "declining_balance":
        yearly = rate / Decimal(100) if rate > ZERO else (
            Decimal(24) / Decimal(life) if life else ZERO)
        raw = to_money(to_money(cost - accumulated) * yearly / Decimal(12))
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
        if life:
            raw = to_money(depreciable / Decimal(life))
        elif rate > ZERO:
            raw = to_money(depreciable * rate / Decimal(1200))
        else:
            return ZERO

    return remaining if raw > remaining else raw
