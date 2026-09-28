"""التحديث الحي — «حصل تغيير في كذا» بيوصل للشاشات المفتوحة من غير ما حد يعمل ريفرش.

الفاتورة اللي بتترفع من التطبيق، والسند، والتحويل، والمرتجع — كانوا بيبانوا في الشاشة
المفتوحة بس لما اللي قاعد قدامها يعمل ريفرش بإيده. فهو يا إما بيشتغل على أرقام قديمة، يا
إما بيعمل ريفرش كل شوية وبيضيّع اللي كان كاتبه.

الحل هنا من طبقتين:

* **ميدل وير** بيمسك أي طلب بيغيّر حاجة ونجح (2xx) وبيعلن «الموضوع ده اتغيّر» — الموضوع
  هو أول جزء في المسار بعد `/api/v1/` (`sales`، `vouchers`، `transfers`…). نفس فكرة سجل
  العمليات في `core/request_audit.py`: بدل ما كل خدمة تفتكر تعلن، الطبقة اللي تحت بتعلن
  عن الكل — فخدمة جديدة بتتكتب بكرة بتتعلن من غير ما حد يفتكر.
* **موزّع في نفس العملية** (طابور لكل مشترك) بيوصّل الإعلان لكل اتصال SSE مفتوح.

**الإعلان مافيهوش داتا** — موضوع وطريقة ومسار ووقت بس. الشاشة هي اللي بتطلب داتاها من
جديد بصلاحياتها هي، فمافيش حاجة بتعدّي لحد مالوش يشوفها حتى لو الإعلان وصل للكل.

**ليه في الذاكرة مش Redis.** الإنتاج شغّال بعامل واحد (`--workers 1`)، فكل الطلبات وكل
الاتصالات في نفس العملية. لو اتزوّد العمّال يوم، الإعلان هيوصل بس لاتصالات نفس العامل —
ساعتها بيتنقل لـ Postgres `LISTEN/NOTIFY` والباقي زي ما هو.
"""
from __future__ import annotations

import asyncio
import logging
import signal
import time

from src.core.request_audit import _actor_id

log = logging.getLogger(__name__)

_MUTATING = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_PREFIX = "/api/v1/"

# مواضيع مابتتعلنش:
# * `auth` — الدخول والتجديد والخروج مش تغيير في داتا حد شايفها.
# * `live` — الاتصال نفسه.
# * `drafts` — المسودّة بتتحفظ مع الكتابة، يعني إعلان كل كام ثانية لكل الناس على حاجة
#   مافيش شاشة بتعرضها لحد تاني.
_SKIP_TOPICS = frozenset({"auth", "live", "drafts"})

# طابور كل مشترك محدود: اتصال واقف (لابتوب نايم والسوكيت لسه مااتقفلش) مايفضلش ياكل
# ذاكرة. لو اتملى بنرمي الجديد — والعميل لما يرجع بيعمل تحديث شامل على أي حال.
_QUEUE_MAX = 200

_subscribers: set[asyncio.Queue] = set()

# بيتقلب لما السيرفر بيقفل. شوف `_watch_shutdown`.
_closing = False
_signals_hooked = False
_loop: asyncio.AbstractEventLoop | None = None

# علامة بتتحط في الطابور عشان توقّظ الاتصال فوراً وقت القفل بدل ما يستنى النبضة الجاية.
CLOSE = object()


def topic_of(path: str) -> str | None:
    """`/api/v1/sales/12/returns` ⇐ `sales`. واللي برّه `/api/v1/` مالوش موضوع."""
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
    """بيتنادى من جوّه اللوب بس (الميدل وير) — `put_nowait` مش آمنة من خيط تاني."""
    for q in list(_subscribers):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass


def _watch_shutdown() -> None:
    """يخلّي اتصالات SSE تتقفل أول ما السيرفر يستلم أمر الإيقاف.

    uvicorn وقت الإيقاف **بيستنى كل الردود المفتوحة تخلص** — ومن غير
    `--timeout-graceful-shutdown` بيستنى للأبد. واتصال SSE مابيخلصش لوحده، فأي تبويب
    مفتوح على النظام كان هيعلّق إعادة التشغيل بعد كل نشر لحد ما systemd يقتل العملية.

    فبنلف على معالج الإشارة اللي uvicorn ركّبه (مش بنشيله): نعلّم إننا بنقفل، نصحّي كل
    الاتصالات، وبعدين نسلّم لـ uvicorn يكمّل زي ما كان هيعمل. بيتركّب مرة واحدة من أول
    اشتراك — ساعتها uvicorn يكون ركّب معالجه خلاص، واحنا في الخيط الرئيسي.
    """
    global _signals_hooked, _loop
    if _signals_hooked:
        return
    _signals_hooked = True
    _loop = asyncio.get_running_loop()
    sigs = [signal.SIGINT, signal.SIGTERM]
    if hasattr(signal, "SIGBREAK"):  # ويندوز
        sigs.append(signal.SIGBREAK)
    for sig in sigs:
        try:
            prev = signal.getsignal(sig)
            if not callable(prev):
                continue

            def _handler(signum, frame, _prev=prev):
                global _closing
                _closing = True
                # المعالج ممكن يتنادى في نص أي سطر جوّه اللوب، فالطوابير ماتتلمسش من هنا
                # مباشرةً — `call_soon_threadsafe` هي الطريقة الآمنة الوحيدة تصحّي اللوب.
                if _loop is not None and not _loop.is_closed():
                    _loop.call_soon_threadsafe(_wake_all)
                _prev(signum, frame)

            signal.signal(sig, _handler)
        except (ValueError, OSError):  # مش الخيط الرئيسي — الحد الأقصى لعمر الاتصال بيغطّي
            pass


class LiveEventsMiddleware:
    """ASGI خام زي `RequestAuditMiddleware` — بيبص على الحالة وبيعدّي الرد زي ما هو."""

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

        # بعد الرد مش قبله: الإعلان عن حاجة لسه ماتحفظتش بيخلّي الشاشة تطلب وتلاقي القديم.
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
        except Exception:  # noqa: BLE001 — الإعلان مايوقعش طلب نجح أصلاً
            log.warning("live: تعذّر إعلان %s", path, exc_info=True)
