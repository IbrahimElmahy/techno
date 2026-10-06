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
PCT = Numeric(5, 2)   # percentages: discount, VAT, depreciation rate
# معامل تحويل الوحدة (كام وحدة أساسية في الوحدة دي). ٣ منازل كانت كفاية للكرتونة = ١٢،
# لكن صنف أساسه «قطعة» ومتباع بـ«المتر» معامله ١÷٣ = ٠٫٣٣٣٣… — مقصوص لـ٠٫٣٣٣ يبقى
# ١٥٠ متر = ٤٩٫٩٥ قطعة بدل ٥٠، ونص قطعة بتضيع من المخزن كل ما حد يبيع بالمتر.
# بـ٩ منازل الغلط في السطر = الكمية × ٥×١٠⁻¹⁰ — بيختفي في تقريب الكمية لـ٣ منازل لأي
# كمية تحت المليون.
FACTOR = Numeric(18, 9)

TWO_PLACES = Decimal("0.01")
THREE_PLACES = Decimal("0.001")
NINE_PLACES = Decimal("0.000000001")
ZERO = Decimal("0.00")
ZERO_QTY = Decimal("0.000")


def to_money(value: Decimal | int | str) -> Decimal:
    """Quantize a value to EGP 2dp using bankers-safe half-up rounding."""
    return Decimal(value).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


def to_qty(value: Decimal | int | str) -> Decimal:
    """Quantize a stock quantity to 3dp (decimal quantities; never float)."""
    return Decimal(value).quantize(THREE_PLACES, rounding=ROUND_HALF_UP)


def to_factor(value: Decimal | int | str) -> Decimal:
    """Quantize a unit conversion factor to 9dp — see `FACTOR`. Never `to_qty` a factor."""
    return Decimal(str(value)).quantize(NINE_PLACES, rounding=ROUND_HALF_UP)
