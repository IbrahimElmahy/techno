from __future__ import annotations

import time
from threading import Lock

MAX_FAILURES = 5
LOCK_SECONDS = 5 * 60
FORGET_SECONDS = 15 * 60

_lock = Lock()
_failures: dict[tuple[str, str], list] = {}


def _prune(now: float) -> None:
    for key, (_count, last) in list(_failures.items()):
        if now - last > FORGET_SECONDS:
            _failures.pop(key, None)


def seconds_locked(username: str, ip: str) -> int:
    key = (username.strip().lower(), ip)
    now = time.time()
    with _lock:
        hit = _failures.get(key)
        if not hit or hit[0] < MAX_FAILURES:
            return 0
        left = LOCK_SECONDS - (now - hit[1])
        if left <= 0:
            _failures[key] = [MAX_FAILURES - 1, now]
            return 0
        return int(left) + 1


def record_failure(username: str, ip: str) -> None:
    key = (username.strip().lower(), ip)
    now = time.time()
    with _lock:
        _prune(now)
        hit = _failures.get(key)
        _failures[key] = [(hit[0] + 1) if hit else 1, now]


def record_success(username: str, ip: str) -> None:
    with _lock:
        _failures.pop((username.strip().lower(), ip), None)


def client_ip(request) -> str:
    fwd = request.headers.get("x-forwarded-for") if request is not None else None
    if fwd:
        return fwd.split(",")[0].strip()[:45]
    client = getattr(request, "client", None) if request is not None else None
    return (getattr(client, "host", None) or "unknown")[:45]
