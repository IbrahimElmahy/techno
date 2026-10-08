from __future__ import annotations

from decimal import Decimal

from src.core.money import to_money

ZERO = Decimal("0")
HUNDRED = Decimal("100")
ONE = Decimal("1")
MAX_PCT = Decimal("99.99")


def _factor(pct: Decimal | float | str | None) -> Decimal:
    return ONE - (Decimal(str(pct or 0)) / HUNDRED)


def remaining(*pcts: Decimal | float | str | None) -> Decimal:
    out = ONE
    for p in pcts:
        out *= _factor(p)
    return out


def combine(*pcts: Decimal | float | str | None) -> Decimal:
    return (HUNDRED * (ONE - remaining(*pcts))).quantize(Decimal("0.01"))


def apply(amount: Decimal | float | str, *pcts: Decimal | float | str | None) -> Decimal:
    return to_money(Decimal(str(amount)) * remaining(*pcts))


def net_of(amount, pct) -> Decimal:
    return to_money(Decimal(str(amount or 0)) * _factor(pct))


def implied_pct(before, after) -> Decimal:
    base = Decimal(str(before or 0))
    net = Decimal(str(after or 0))
    if base <= ZERO or net >= base:
        return ZERO
    pct = to_money(HUNDRED * (base - net) / base)
    return pct if pct <= MAX_PCT else MAX_PCT

