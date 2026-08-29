"""سجل كل عملية بتغيّر حاجة في النظام — مين عملها، إمتى، وعلى أنهي مستند.

`audit_service.record` بيتكتب بالإيد جوّه الخدمات، وبيدّي أغنى صورة: القيمة قبل وبعد.
بس اللي بالإيد بيفضل ناقص دايماً — خدمة جديدة بتتكتب والسطر بيتنسي، وشاشة كاملة تعدّي
من غير أي أثر. تعديل فاتورة البيع نفسه ماكانش بيتسجّل.

الميدل وير دي بتمسك الطبقة اللي تحت: **أي** طلب بيغيّر حاجة (POST/PUT/PATCH/DELETE)
بيتسجّل من هنا، ناجح كان أو مرفوض. والمرفوض مهم زي الناجح بالظبط — محاولة حذف من حد
مالوش صلاحية هي بالضبط الحاجة اللي السجل موجود عشانها.

حاجتين مقصودين:

* **الجسم مابيتسجّلش.** فيه باسوردات فيه. المسار والطريقة والنتيجة بيقولوا اللي محتاج
  يتقال من غير ما السجل يبقى هو نفسه تسريب.
* **بتتكتب في جلسة لوحدها وبتترحّل لوحدها.** الطلب اللي وقع بيترجع أثره كله، فلو السجل
  كان راكب على نفس الجلسة كان هيروح معاه — واللي بيقع هو أكتر حاجة محتاج تتسجّل.

القراءة (GET) مابتتسجّلش: FR-031.
"""
from __future__ import annotations

import logging

from src.core.db import SessionLocal
from src.core.security import decode_access_token
from src.models.audit import AuditLogEntry

log = logging.getLogger(__name__)

_SKIP_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
# الدخول بيتسجّل من `auth` نفسه بالاسم اللي اتكتب بيه — نجح ولا فشل — ومافيش داعي لصف تاني.
_SKIP_PATHS = frozenset({"/api/v1/auth/login", "/api/v1/auth/refresh"})
_VERB = {"POST": "create", "PUT": "update", "PATCH": "update", "DELETE": "delete"}


def _actor_id(scope) -> int | None:
    """رقم اللي بعت الطلب من التوكن نفسه — من غير ما نضرب على قاعدة البيانات.

    الصلاحية مش شغلنا هنا: الراوتر هو اللي بيقرر، والسجل بيكتب اللي حصل مهما كان القرار.
    """
    for key, value in scope.get("headers", ()):
        if key != b"authorization":
            continue
        raw = value.decode("latin-1", "ignore")
        if not raw.lower().startswith("bearer "):
            return None
        payload = decode_access_token(raw[7:].strip())
        if not payload or "sub" not in payload:
            return None
        try:
            return int(payload["sub"])
        except (TypeError, ValueError):
            return None
    return None


def _describe(path: str, method: str) -> tuple[str, str | None, int | None]:
    """(الفعل، نوع الكيان، رقمه) من المسار.

    `/api/v1/sales/12` ⇐ `sales.delete` على الفاتورة ١٢، و`/api/v1/transfers/5/self-approve`
    ⇐ `transfers.self-approve` على الإذن ٥ — الذيل بيوصف العملية أحسن من اسم الطريقة.
    """
    segs = [s for s in path.strip("/").split("/") if s]
    if segs[:2] == ["api", "v1"]:
        segs = segs[2:]
    if not segs:
        return f"http.{_VERB.get(method, method.lower())}", None, None
    resource = segs[0]
    entity_id: int | None = None
    for s in reversed(segs[1:]):
        if s.isdigit():
            entity_id = int(s)
            break
    tail = segs[-1] if len(segs) > 1 and not segs[-1].isdigit() else None
    action = f"{resource}.{tail or _VERB.get(method, method.lower())}"
    return action[:60], resource[:40], entity_id


class RequestAuditMiddleware:
    """ASGI خام — مش `BaseHTTPMiddleware`، عشان مايتحطّش تاسك زيادة بين الطلب والراوتر."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http" or scope.get("method") in _SKIP_METHODS:
            return await self.app(scope, receive, send)
        path = scope.get("path", "")
        if path in _SKIP_PATHS:
            return await self.app(scope, receive, send)

        seen = {}

        async def _send(message):
            if message["type"] == "http.response.start":
                seen["status"] = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, _send)
        finally:
            self._write(scope, path, seen.get("status"))

    def _write(self, scope, path: str, status: int | None) -> None:
        method = scope.get("method", "")
        action, entity_type, entity_id = _describe(path, method)
        client = scope.get("client")
        db = SessionLocal()
        try:
            db.add(AuditLogEntry(
                actor_user_id=_actor_id(scope),
                action=action,
                entity_type=entity_type,
                entity_id=entity_id,
                after_json={
                    "src": "http",
                    "method": method,
                    "path": path,
                    "status": status,
                    "ok": bool(status and status < 400),
                    "ip": client[0] if client else None,
                },
            ))
            db.commit()
        except Exception:  # noqa: BLE001 — السجل مايوقعش الطلب أبداً
            db.rollback()
            log.warning("audit: تعذّر تسجيل %s %s", method, path, exc_info=True)
        finally:
            db.close()
