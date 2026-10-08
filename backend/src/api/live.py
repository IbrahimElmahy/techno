from __future__ import annotations

import asyncio
import json
import secrets
import time

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials

from src.auth.dependencies import CurrentUser, get_current_user
from src.core.db import SessionLocal
from src.lib import live_events

router = APIRouter(tags=["live"], prefix="/live")

_HEARTBEAT_S = 20

_MAX_AGE_S = 10 * 60

_TICKET_TTL_S = 60
_tickets: dict[str, tuple[float, CurrentUser]] = {}


def _take_ticket(ticket: str) -> CurrentUser | None:
    now = time.monotonic()
    for k in [k for k, (t, _) in _tickets.items() if now - t > _TICKET_TTL_S]:
        _tickets.pop(k, None)
    hit = _tickets.pop(ticket, None)
    return hit[1] if hit and now - hit[0] <= _TICKET_TTL_S else None


@router.post("/ticket")
def ticket(current: CurrentUser = Depends(get_current_user)) -> dict:
    t = secrets.token_urlsafe(24)
    _tickets[t] = (time.monotonic(), current)
    return {"ticket": t}


def _authenticate(raw: str):
    db = SessionLocal()
    try:
        return get_current_user(
            HTTPAuthorizationCredentials(scheme="Bearer", credentials=raw), db)
    finally:
        db.close()


@router.get("/events")
async def events(request: Request, ticket: str | None = Query(default=None)):
    if ticket:
        user = _take_ticket(ticket)
        if user is None:
            raise HTTPException(401, {"code": "unauthorized", "message": "انتهت صلاحية التذكرة"})
    else:
        auth = request.headers.get("authorization") or ""
        raw = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
        user = await run_in_threadpool(_authenticate, raw)

    async def stream():
        q = live_events.subscribe()
        started = time.monotonic()
        try:
            yield f"retry: 3000\n: connected {user.id}\n\n"
            while not live_events.closing():
                if time.monotonic() - started > _MAX_AGE_S:
                    break
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=_HEARTBEAT_S)
                except asyncio.TimeoutError:
                    if await request.is_disconnected():
                        break
                    yield ": ping\n\n"
                    continue
                if ev is live_events.CLOSE:
                    break
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
        finally:
            live_events.unsubscribe(q)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
