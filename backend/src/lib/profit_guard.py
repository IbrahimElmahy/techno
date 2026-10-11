from __future__ import annotations

import re

from src.auth.rbac import CAP_PROFIT_VIEW

_SENSITIVE = re.compile(r"(cost|profit|margin)|^purchase_(price|net|value|discount_pct)$")


def hidden(key: str) -> bool:
    return bool(_SENSITIVE.search(key))


def scrub(data, extra: frozenset[str] = frozenset()):
    if isinstance(data, dict):
        return {k: scrub(v, extra) for k, v in data.items()
                if not (isinstance(k, str) and (hidden(k) or k in extra))}
    if isinstance(data, list):
        return [scrub(v, extra) for v in data]
    return data


def guard(current, data, extra: frozenset[str] = frozenset()):
    return data if current.can(CAP_PROFIT_VIEW) else scrub(data, extra)
