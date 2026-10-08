from __future__ import annotations

import re

_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")

_SPLIT = re.compile(r"[،,;/\\\|\n\r\t]+|\s{2,}|\s+-\s+")

_PLACEHOLDERS = {"", "0", "1", "00", "000", "0000000", "00000000", "-", ".", "لا يوجد", "لايوجد"}

_MOBILE_PREFIX = ("10", "11", "12", "15")


def _bare(value) -> str:
    text = str(value if value is not None else "").translate(_DIGITS)
    return re.sub(r"\D", "", text)


def normalize(value) -> str | None:
    raw = str(value if value is not None else "").strip()
    if raw.casefold() in _PLACEHOLDERS:
        return None
    digits = _bare(raw)
    if not digits or set(digits) == {"0"}:
        return None

    if digits.startswith("0020"):
        digits = digits[4:]
    if len(digits) == 12 and digits.startswith("20") and digits[2] == "1":
        digits = digits[2:]

    if len(digits) == 10 and digits[:2] in _MOBILE_PREFIX:
        digits = "0" + digits

    if len(digits) == 11 and digits.startswith("0") and digits[1:3] in _MOBILE_PREFIX:
        return digits
    if digits.startswith("0") and 7 <= len(digits) <= 10:
        return digits
    if 6 <= len(digits) <= 10:
        return digits
    return None


def split_numbers(value) -> list[str]:
    raw = str(value if value is not None else "").strip()
    if not raw:
        return []
    parts = [p for p in _SPLIT.split(raw) if p.strip()]
    if len(parts) == 1:
        dash = re.split(r"\s*-\s*", raw)
        if len(dash) == 2 and all(normalize(d) for d in dash):
            parts = dash
    out: list[str] = []
    for part in parts:
        num = normalize(part)
        if num and num not in out:
            out.append(num)
    return out


def is_placeholder(value) -> bool:
    return normalize(value) is None and str(value or "").strip() != ""


def display(value) -> str:
    return normalize(value) or ""
