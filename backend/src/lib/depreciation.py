"""Depreciation arithmetic — pure functions, no database (B6).

Kept separate from the service on purpose: this is the part that is easy to get subtly wrong
(the last month, the salvage floor, an asset bought mid-life), and pure functions can be tested
against those edges directly.

The one rule every method obeys: an asset depreciates down to its salvage value and no further.
Whatever the formula produces, the final month is trimmed to whatever is actually left, so total
depreciation over the asset's life equals cost − salvage exactly, never a rounding penny more.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from src.core.money import ZERO, to_money


def months_between(start: date, year: int, month: int) -> int:
    """How many months into the asset's life the given period is; 0 is the month it was bought."""
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
    """The depreciation for ONE month, given what has already been taken.

    `periods_elapsed` is 0 for the month of acquisition. A negative value means the period is
    before the asset existed, which depreciates nothing — an asset cannot be consumed before it
    is bought.
    """
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
        # Double-declining: twice the straight-line rate, applied to what is still on the books.
        # It front-loads the expense, which is the reason anyone picks it.
        rate = (Decimal(2) / Decimal(useful_life_months))
        book_value = to_money(cost - accumulated)
        raw = to_money(book_value * rate)
    else:
        raw = to_money(depreciable / Decimal(useful_life_months))

    # Never below zero, never past the salvage floor. The final month takes exactly what is left,
    # so the life total is cost − salvage to the piastre.
    return remaining if raw > remaining else raw
