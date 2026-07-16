"""EGP money helpers (T006).

All monetary amounts are DECIMAL(18,2) in EGP. Arithmetic uses Decimal — never float.
Currency is implicit (single-currency system per Constitution Principle VIII); no currency column.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import Numeric

# Reusable column types.
MONEY = Numeric(18, 2)
QTY = Numeric(18, 3)  # stock quantities — decimal, per-item unit of measure (FR-002a)

TWO_PLACES = Decimal("0.01")
THREE_PLACES = Decimal("0.001")
ZERO = Decimal("0.00")
ZERO_QTY = Decimal("0.000")


def to_money(value: Decimal | int | str) -> Decimal:
    """Quantize a value to EGP 2dp using bankers-safe half-up rounding."""
    return Decimal(value).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


def to_qty(value: Decimal | int | str) -> Decimal:
    """Quantize a stock quantity to 3dp (decimal quantities; never float)."""
    return Decimal(value).quantize(THREE_PLACES, rounding=ROUND_HALF_UP)
