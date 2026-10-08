from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import Numeric

MONEY = Numeric(18, 2)
QTY = Numeric(18, 3)
PCT = Numeric(5, 2)
FACTOR = Numeric(18, 9)

TWO_PLACES = Decimal("0.01")
THREE_PLACES = Decimal("0.001")
NINE_PLACES = Decimal("0.000000001")
ZERO = Decimal("0.00")
ZERO_QTY = Decimal("0.000")


def to_money(value: Decimal | int | str) -> Decimal:
    return Decimal(value).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


def to_qty(value: Decimal | int | str) -> Decimal:
    return Decimal(value).quantize(THREE_PLACES, rounding=ROUND_HALF_UP)


def to_factor(value: Decimal | int | str) -> Decimal:
    return Decimal(str(value)).quantize(NINE_PLACES, rounding=ROUND_HALF_UP)
