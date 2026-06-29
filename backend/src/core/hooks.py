"""Tiny in-process event registry (T002).

Lets a lower feature (002 sales) emit named domain events that a higher feature (003 loyalty)
subscribes to — **without** the lower feature importing the higher one. Emitting an event with no
subscribers is a no-op, so 002 stays fully functional on its own.

Subscribers run synchronously, in the caller's DB transaction (before commit), so side effects are
transactional with the originating operation.
"""
from __future__ import annotations

from collections.abc import Callable

_subscribers: dict[str, list[Callable]] = {}


def subscribe(event: str, fn: Callable) -> None:
    """Register a handler for a named event (idempotent per fn)."""
    handlers = _subscribers.setdefault(event, [])
    if fn not in handlers:
        handlers.append(fn)


def emit(event: str, *args, **kwargs) -> None:
    """Invoke all handlers for an event in registration order. No-op if none."""
    for fn in _subscribers.get(event, []):
        fn(*args, **kwargs)


def clear(event: str | None = None) -> None:
    """Test helper: clear handlers for one event or all."""
    if event is None:
        _subscribers.clear()
    else:
        _subscribers.pop(event, None)
