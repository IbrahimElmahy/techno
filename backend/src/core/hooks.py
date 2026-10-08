from __future__ import annotations

from collections.abc import Callable

_subscribers: dict[str, list[Callable]] = {}


def subscribe(event: str, fn: Callable) -> None:
    handlers = _subscribers.setdefault(event, [])
    if fn not in handlers:
        handlers.append(fn)


def emit(event: str, *args, **kwargs) -> None:
    for fn in _subscribers.get(event, []):
        fn(*args, **kwargs)


def clear(event: str | None = None) -> None:
    if event is None:
        _subscribers.clear()
    else:
        _subscribers.pop(event, None)
