from __future__ import annotations

import re


def sale(number: str) -> str:
    return f"فاتورة بيع {number}"


def sale_return(number: str) -> str:
    return f"مرتجع بيع {number}"


def purchase(number: str) -> str:
    return f"فاتورة شراء {number}"


def purchase_return(number: str) -> str:
    return f"مرتجع شراء {number}"


def coupon_redeemed(serial: str) -> str:
    return f"صرف كوبون {serial}"


def coupon_unredeemed(serial: str) -> str:
    return f"إلغاء صرف كوبون {serial}"


def reversal(entry_id) -> str:
    return f"عكس القيد {entry_id}"


_LEGACY: tuple[tuple[re.Pattern, object], ...] = (
    (re.compile(r"^Sale (\S+)$"), lambda m: sale(m[1])),
    (re.compile(r"^Sales return (\S+)$"), lambda m: sale_return(m[1])),
    (re.compile(r"^(?:Standalone purchase|Purchase) return (\S+)$"),
     lambda m: purchase_return(m[1])),
    (re.compile(r"^Purchase (\S+)$"), lambda m: purchase(m[1])),
    (re.compile(r"^Coupon (\S+) redeemed \(\w+\)$"), lambda m: coupon_redeemed(m[1])),
    (re.compile(r"^Reverse redemption of coupon (\S+)$"), lambda m: coupon_unredeemed(m[1])),
    (re.compile(r"^Reversal of entry (\S+)$"), lambda m: reversal(m[1])),
)


def arabic(description: str | None) -> str:
    text = description or ""
    if not text or not ("A" <= text[0] <= "Z"):
        return text
    for rx, render in _LEGACY:
        m = rx.match(text)
        if m:
            return render(m)
    return text
