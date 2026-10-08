from __future__ import annotations

import asyncio
import logging
import signal
import time

from src.core.request_audit import _actor_id

log = logging.getLogger(__name__)

_MUTATING = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_PREFIX = "/api/v1/"

_SKIP_TOPICS = frozenset({"auth", "live", "drafts"})

_QUEUE_MAX = 200

_subscribers: set[asyncio.Queue] = set()

_closing = False
_signals_hooked = False
_loop: asyncio.AbstractEventLoop | None = None

CLOSE = object()


def topic_of(path: str) -> str | None:
    if not path.startswith(_PREFIX):
        return None
    rest = path[len(_PREFIX):]
    seg = rest.split("/", 1)[0]
    return seg or None


def subscribe() -> asyncio.Queue:
    _watch_shutdown()
    q: asyncio.Queue = asyncio.Queue(maxsize=_QUEUE_MAX)
    _subscribers.add(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    _subscribers.discard(q)


def closing() -> bool:
    return _closing


def _wake_all() -> None:
    for q in list(_subscribers):
        try:
            q.put_nowait(CLOSE)
        except asyncio.QueueFull:
            pass


def publish(event: dict) -> None:
    for q in list(_subscribers):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass


def _watch_shutdown() -> None:
    global _signals_hooked, _loop
    if _signals_hooked:
        return
    _signals_hooked = True
    _loop = asyncio.get_running_loop()
    sigs = [signal.SIGINT, signal.SIGTERM]
    if hasattr(signal, "SIGBREAK"):
        sigs.append(signal.SIGBREAK)
    for sig in sigs:
        try:
            prev = signal.getsignal(sig)
            if not callable(prev):
                continue

            def _handler(signum, frame, _prev=prev):
                global _closing
                _closing = True
                if _loop is not None and not _loop.is_closed():
                    _loop.call_soon_threadsafe(_wake_all)
                _prev(signum, frame)

            signal.signal(sig, _handler)
        except (ValueError, OSError):
            pass


class LiveEventsMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http" or scope.get("method") not in _MUTATING:
            return await self.app(scope, receive, send)
        path = scope.get("path", "")
        topic = topic_of(path)
        if topic is None or topic in _SKIP_TOPICS:
            return await self.app(scope, receive, send)

        seen = {}

        async def _send(message):
            if message["type"] == "http.response.start":
                seen["status"] = message["status"]
            await send(message)

        await self.app(scope, receive, _send)

        status = seen.get("status") or 0
        if not (200 <= status < 300) or not _subscribers:
            return
        try:
            publish({
                "topic": topic,
                "method": scope.get("method"),
                "path": path,
                "ts": time.time(),
                "actor": _actor_id(scope),
            })
        except Exception:  # noqa: BLE001
            log.warning("live: تعذّر إعلان %s", path, exc_info=True)
