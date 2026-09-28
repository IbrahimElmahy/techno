"""`GET /live/events` — قناة SSE بتقول للشاشات المفتوحة «الموضوع ده اتغيّر».

الشرح الكامل في `lib/live_events.py`. هنا الاتصال نفسه بس.
"""
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

# نبضة كل ٢٠ ثانية: الوسطاء (nginx وأي بروكسي في شبكة العميل) بيقفلوا الاتصال الساكت
# بعد دقيقة تقريباً، والنبضة كمان هي اللي بتكشف إن الطرف التاني مشي.
_HEARTBEAT_S = 20

# الاتصال بيتقفل من عندنا كل فترة والمتصفح بيرجع يفتحه بالتوكن الجديد. التوكن بيتفحص
# مرة واحدة عند الفتح، فمن غير الحد ده حساب اتقفل أو اتفتح من جهاز تاني كان هيفضل مستلم
# إعلانات لحد ما يقفل التبويب. الإعلانات مافيهاش داتا، فعشر دقايق تأخير مقبول.
_MAX_AGE_S = 10 * 60

# **تذكرة الاتصال بدل التوكن في الرابط.** `EventSource` مابيبعتش هيدر، والرابط بيتسجّل في
# لوج nginx — فالتوكن نفسه (صالح أيام) كان هيتكتب في ملف على السيرفر مع كل فتح. التذكرة
# بتتاخد بالتوكن في الهيدر زي أي نداء، وبتنفع مرة واحدة وفي خلال دقيقة؛ اللي يلاقيها في
# اللوج مايعملش بيها حاجة. في الذاكرة لأن الخدمة worker واحد (شوف `lib/live_events.py`).
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
    """نفس `get_current_user` بالظبط — التوكن، الحساب نشط، والجهاز الواحد.

    `EventSource` مابيقدرش يبعت هيدر، فالتوكن جاي في الرابط. بنلفّه في نفس الشكل اللي
    الاعتماد العادي بيستلمه ونناديه — مافيش نسخة تانية من الفحص تتنسي لما الأصل يتغيّر.
    الجلسة بتتقفل هنا قبل ما البث يبدأ: جلسة قاعدة مفتوحة طول عمر الاتصال كانت هتاكل
    اتصال من الـpool لكل تبويب مفتوح.
    """
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
            raise HTTPException(401, {"code": "unauthorized", "message": "التذكرة انتهت"})
    else:
        # من غير تذكرة ⇒ هيدر Bearer (أدوات وسكربتات)، ونفس الـ401 لو مافيش.
        auth = request.headers.get("authorization") or ""
        raw = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
        user = await run_in_threadpool(_authenticate, raw)

    async def stream():
        q = live_events.subscribe()
        started = time.monotonic()
        try:
            # `retry` بيقول للمتصفح يستنى قد إيه قبل ما يعيد الاتصال لوحده. والتعليق الأول
            # بيفتح الرد فوراً، عشان `onopen` مايستناش أول إعلان أو أول نبضة.
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
            # nginx بيخزّن الرد لحد ما يتملى بافر — يعني الإعلان مايوصلش غير بعد ما كذا
            # واحد يتجمّعوا. الهيدر ده بيقفل التخزين للرد ده بس.
            "X-Accel-Buffering": "no",
        },
    )
