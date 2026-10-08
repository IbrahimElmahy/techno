from __future__ import annotations

from src.lib import arabic

STATEMENT_FIELDS = ("statement1", "statement2", "statement3")

JOINER = " · "


def _norm(text: str | None) -> str:
    return " ".join(arabic.bare(text).split())


def needle(q: str | None) -> str:
    return _norm(q) if q and q.strip() else ""


def _fields(extra: tuple[str, ...] = ()) -> tuple[str, ...]:
    return (*STATEMENT_FIELDS, *extra)


def supported(model, extra: tuple[str, ...] = ()) -> bool:
    return any(hasattr(model, f) for f in _fields(extra))


def text_of(obj, extra: tuple[str, ...] = ()) -> str | None:
    if obj is None:
        return None
    parts = [str(v).strip() for f in _fields(extra)
             if (v := getattr(obj, f, None)) and str(v).strip()]
    return JOINER.join(parts) or None


def matches(text: str | None, wanted: str) -> bool:
    if not wanted:
        return True
    return bool(text) and wanted in _norm(text)


def matches_obj(obj, wanted: str, extra: tuple[str, ...] = ()) -> bool:
    return matches(text_of(obj, extra), wanted)
