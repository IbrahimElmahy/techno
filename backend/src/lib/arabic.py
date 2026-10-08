from __future__ import annotations

from sqlalchemy import func

_FROM = "أإآٱؤئىة"
_TO___ = "ااااوييه"

_STRIP = "ـًٌٍَُِّْٰ"

_EASTERN = "٠١٢٣٤٥٦٧٨٩"
_WESTERN = "0123456789"
_PERSIAN = "۰۱۲۳۴۵۶۷۸۹"

_TO_EASTERN = str.maketrans(_WESTERN, _EASTERN)
_TO_WESTERN = str.maketrans(_EASTERN + _PERSIAN, _WESTERN + _WESTERN)


def eastern_digits(text: str | None) -> str | None:
    if text is None:
        return None
    return text.translate(_TO_EASTERN)


def western_digits(text: str | None) -> str | None:
    if text is None:
        return None
    return text.translate(_TO_WESTERN)


def sort_key(column):
    return func.translate(
        func.translate(
            func.translate(func.lower(column), _EASTERN + _PERSIAN, _WESTERN + _WESTERN),
            _STRIP, ""),
        _FROM, _TO___)


def match_order(needle: str | None, *columns):
    from sqlalchemy import case

    n = bare(needle) if needle else ""
    if not n:
        return ()
    whens = []
    for col in columns:
        k = sort_key(col)
        whens.append((k.like(f"{n}%"), 0))
    for col in columns:
        k = sort_key(col)
        whens.append((k.like(f"% {n}%"), 1))
    return (case(*whens, else_=2),)


def bare(text: str | None) -> str:
    s = (text or "").strip().lower().translate(_TO_WESTERN)
    for ch in _STRIP:
        s = s.replace(ch, "")
    return s.translate(str.maketrans(_FROM, _TO___))
