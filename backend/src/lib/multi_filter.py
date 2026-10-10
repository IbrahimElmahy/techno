from __future__ import annotations

from collections.abc import Iterable


def _items(v, sep: str = ",") -> list[str]:
    if v is None:
        return []
    if isinstance(v, (list, tuple, set)):
        return [str(x).strip() for x in v if x is not None and str(x).strip()]
    return [x.strip() for x in str(v).split(sep) if x.strip()]


def ids(v) -> list[int] | None:
    out = [int(x) for x in _items(v)]
    return out or None


def strs(v, sep: str = ",") -> list[str] | None:
    out = _items(v, sep)
    return out or None


def categories(db, v) -> list[str] | None:
    from src.services import lookup_service
    names = strs(v)
    if not names:
        return None
    seen: list[str] = []
    for n in names:
        for c in lookup_service.with_children(db, lookup_service.ITEM_CATEGORY, n):
            if c not in seen:
                seen.append(c)
    return seen


def joined(values: Iterable) -> str:
    return ",".join(str(v) for v in values)
