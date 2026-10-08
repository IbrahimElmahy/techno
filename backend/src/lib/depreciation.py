from __future__ import annotations

from datetime import date
from decimal import Decimal

from src.core.money import ZERO, to_money


def months_between(start: date, year: int, month: int) -> int:
    return (year - start.year) * 12 + (month - start.month)


def monthly_amount(
    *,
    cost: Decimal,
    salvage_value: Decimal,
    useful_life_months: int,
    method: str,
    accumulated: Decimal,
    periods_elapsed: int,
) -> Decimal:
    cost = to_money(cost)
    salvage_value = to_money(salvage_value)
    accumulated = to_money(accumulated)

    if periods_elapsed < 0 or useful_life_months <= 0:
        return ZERO

    depreciable = to_money(cost - salvage_value)
    if depreciable <= ZERO:
        return ZERO

    remaining = to_money(depreciable - accumulated)
    if remaining <= ZERO:
        return ZERO

    if method == "declining_balance":
        rate = (Decimal(2) / Decimal(useful_life_months))
        book_value = to_money(cost - accumulated)
        raw = to_money(book_value * rate)
    else:
        raw = to_money(depreciable / Decimal(useful_life_months))

    return remaining if raw > remaining else raw
