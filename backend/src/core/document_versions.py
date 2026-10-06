"""نسخة من المستند مع كل عملية عليه — لزرار «السجل» (٢٠٢٦-١٠-٠٦).

طلب المالك: «مين عمل إيه، إمتى، والمستند كان شكله إيه قبلها» — في كل المستندات وكل العمليات.

**ليه طبقة واحدة مش سطر في كل خدمة.** `audit_service.record` بالإيد ناقص دايماً (تقرير
السجل: تحويل جديد واعتماده الذاتي وأصناف وموردين من غير ولا سطر)، وكان بيحفظ رقم المستند
وإجماليه بس. هنا كل طلب بيغيّر مستند معروف (الجدول تحت) بيتمسك في مكان واحد:

1. قبل الطلب: المستند بيتقري بنفس الـGET بتاعه — لو مالوش نسخة قبل كده، الشكل ده بيتحفظ
   `baseline` (المستندات اللي اتعملت قبل الطبقة دي).
2. الطلب بيعدّي زي ما هو.
3. لو نجح: المستند بيتقري تاني ويتحفظ نسخة بالعملية (`update`، `reverse`، `approve`…). الإنشاء
   رقمه من رد الطلب. والمسح بيتحفظ بآخر شكل قبل المسح.

**الشكل = رد الـGET بالحرف** — نفس الـJSON اللي الشاشة بتعرضه، فالنسخة القديمة بتتقري بنفس
المنطق، والـGET بيتعمل بنفس ترويسات المستخدم (صلاحياته وفرعه).

مابتوقّعش الطلب أبداً: أي غلطة هنا بتتسجّل في اللوج والطلب بيكمّل. وبتكتب في جلسة لوحدها.
"""
from __future__ import annotations

import json
import logging
import re

from sqlalchemy import func, select, text

from src.core.db import SessionLocal
from src.core.request_audit import _actor_id
from src.models.document_version import DocumentVersion

log = logging.getLogger(__name__)

# نوع المستند ← مسار قرايته.
GET_PATH = {
    "sales_invoice": "/api/v1/sales/{id}",
    "sales_return": "/api/v1/sales/returns/{id}",
    "purchase_invoice": "/api/v1/purchases/{id}",
    "purchase_return": "/api/v1/purchases/returns/{id}",
    "voucher": "/api/v1/vouchers/{id}",
    "stock_transfer": "/api/v1/transfers/{id}",
    "stock_permit": "/api/v1/stock/permits/{id}",
    "production_order": "/api/v1/manufacturing/production-orders/{id}",
    "manufacturing_order": "/api/v1/manufacturing/orders/{id}",
    "sales_order": "/api/v1/orders/{id}",
    "journal_entry": "/api/v1/journal-entries/{id}",
    "stock_count": "/api/v1/stock-counts/{id}",
}

# (الطرق، المسار بعد /api/v1، نوع المستند، رقم الجروب اللي فيه رقم المستند أو None للإنشاء،
#  العملية أو None = من الطريقة/آخر المسار). الترتيب مهم: «sales/returns» قبل «sales/{id}».
_RULES: list[tuple[frozenset, re.Pattern, str, int | None, str | None]] = []


def _r(methods: str, pattern: str, entity: str, group: int | None, action: str | None = None):
    _RULES.append((frozenset(methods.split(",")), re.compile(f"^{pattern}$"), entity, group, action))


_r("POST", r"/sales/returns", "sales_return", None, "create")
_r("POST", r"/sales/\d+/returns", "sales_return", None, "create")
_r("PUT,DELETE", r"/sales/returns/(\d+)", "sales_return", 1)
_r("POST", r"/sales", "sales_invoice", None, "create")
_r("PUT,DELETE", r"/sales/(\d+)", "sales_invoice", 1)
_r("POST", r"/purchases/returns", "purchase_return", None, "create")
_r("POST", r"/purchases/\d+/returns", "purchase_return", None, "create")
_r("PUT,DELETE", r"/purchases/returns/(\d+)", "purchase_return", 1)
_r("POST", r"/purchases", "purchase_invoice", None, "create")
_r("PUT,DELETE", r"/purchases/(\d+)", "purchase_invoice", 1)
_r("POST", r"/vouchers/(?:receipts|payments|expenses|handovers|transfers)", "voucher", None, "create")
_r("PUT", r"/vouchers/(?:receipts|payments)/(\d+)", "voucher", 1, "update")
_r("DELETE", r"/vouchers/(\d+)", "voucher", 1)
_r("POST", r"/vouchers/(\d+)/reverse", "voucher", 1, "reverse")
_r("POST", r"/transfers", "stock_transfer", None, "create")
_r("PATCH,DELETE", r"/transfers/lines/(\d+)", "stock_transfer", 1, "lines")   # رقم السطر ⇐ الإذن
_r("PATCH,DELETE", r"/transfers/(\d+)", "stock_transfer", 1)
_r("POST", r"/transfers/(\d+)/(?:approve|cancel|lines|reject|self-approve)", "stock_transfer", 1)
_r("POST", r"/stock/permits", "stock_permit", None, "create")
_r("PUT,DELETE", r"/stock/permits/(\d+)", "stock_permit", 1)
_r("POST", r"/stock/permits/(\d+)/reverse", "stock_permit", 1, "reverse")
_r("POST", r"/manufacturing/production-orders", "production_order", None, "create")
_r("PUT,DELETE", r"/manufacturing/production-orders/(\d+)", "production_order", 1)
_r("POST", r"/manufacturing/production-orders/(\d+)/(?:confirm|execute|issue-quality|receive|reverse|start)",
   "production_order", 1)
_r("DELETE", r"/manufacturing/production-orders/(\d+)/receipts/\d+", "production_order", 1, "receipts")
_r("POST", r"/manufacturing/orders", "manufacturing_order", None, "create")
_r("POST", r"/manufacturing/orders/(\d+)/reverse", "manufacturing_order", 1, "reverse")
_r("POST", r"/orders", "sales_order", None, "create")
_r("POST", r"/orders/(\d+)/(?:cancel|convert)", "sales_order", 1)
_r("POST", r"/journal-entries", "journal_entry", None, "create")
_r("PATCH", r"/journal-entries/(\d+)", "journal_entry", 1, "update")
_r("POST", r"/journal-entries/(\d+)/(?:cancel|post|reset-to-draft|reverse)", "journal_entry", 1)
_r("POST", r"/stock-counts", "stock_count", None, "create")
_r("PUT", r"/stock-counts/(\d+)/counts", "stock_count", 1, "counts")
_r("POST", r"/stock-counts/(\d+)/(?:cancel|post)", "stock_count", 1)

_VERB = {"PUT": "update", "PATCH": "update", "DELETE": "delete", "POST": "create"}


def match(method: str, path: str):
    """(نوع المستند، رقمه أو None، العملية) — أو None لو الطلب مش على مستند متابَع."""
    if not path.startswith("/api/v1/"):
        return None
    rest = path[len("/api/v1"):].rstrip("/")
    for methods, rx, entity, group, action in _RULES:
        if method not in methods:
            continue
        m = rx.match(rest)
        if not m:
            continue
        doc_id = int(m.group(group)) if group else None
        if action is None:
            tail = rest.rsplit("/", 1)[-1]
            action = tail if not tail.isdigit() else _VERB.get(method, method.lower())
        return entity, doc_id, action
    return None


def _transfer_of_line(line_id: int) -> int | None:
    db = SessionLocal()
    try:
        return db.execute(text("select transfer_id from stock_transfer_line where id = :i"),
                          {"i": line_id}).scalar()
    except Exception:  # noqa: BLE001
        return None
    finally:
        db.close()


class DocumentVersionMiddleware:
    """ASGI خام وجوّه كل الطبقات — الـGET الداخلي بيروح للراوتر على طول."""

    def __init__(self, app):
        self.app = app

    async def _get(self, scope, path: str):
        """يقرا المستند بنفس ترويسات المستخدم. None لو مش موجود أو ممنوع."""
        headers = [(k, v) for k, v in scope.get("headers", ())
                   if k not in (b"content-length", b"content-type", b"accept-encoding")]
        sub = dict(scope)
        sub.update({"method": "GET", "path": path, "raw_path": path.encode(),
                    "query_string": b"", "headers": headers})
        status = {}
        chunks: list[bytes] = []

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            if message["type"] == "http.response.start":
                status["code"] = message["status"]
            elif message["type"] == "http.response.body":
                chunks.append(message.get("body", b""))

        try:
            await self.app(sub, receive, send)
        except Exception:  # noqa: BLE001
            return None
        if status.get("code") != 200:
            return None
        try:
            return json.loads(b"".join(chunks) or b"null")
        except ValueError:
            return None

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http" or scope.get("method") in ("GET", "HEAD", "OPTIONS"):
            return await self.app(scope, receive, send)
        hit = match(scope.get("method", ""), scope.get("path", ""))
        if hit is None:
            return await self.app(scope, receive, send)
        entity, doc_id, action = hit
        if action == "lines" and scope.get("path", "").find("/transfers/lines/") >= 0 and doc_id:
            doc_id = _transfer_of_line(doc_id)

        before = None
        if doc_id:
            try:
                before = await self._get(scope, GET_PATH[entity].format(id=doc_id))
            except Exception:  # noqa: BLE001
                before = None

        seen: dict = {}
        body: list[bytes] = []

        async def _send(message):
            if message["type"] == "http.response.start":
                seen["status"] = message["status"]
            elif message["type"] == "http.response.body" and doc_id is None:
                body.append(message.get("body", b""))
            await send(message)

        await self.app(scope, receive, _send)

        status = seen.get("status") or 500
        if status >= 400:
            return
        try:
            if doc_id is None:
                try:
                    payload = json.loads(b"".join(body) or b"null")
                except ValueError:
                    payload = None
                if isinstance(payload, dict) and isinstance(payload.get("id"), int):
                    doc_id = payload["id"]
                else:
                    return
            # المسح: آخر شكل قبله هو النسخة. غير كده (حتى مسح سطر أو استلام): الشكل بعدها.
            after = None if action == "delete" else await self._get(
                scope, GET_PATH[entity].format(id=doc_id))
            snap = after if after is not None else before
            if snap is None:
                return
            self._write(scope, entity, doc_id, action, before, snap)
        except Exception:  # noqa: BLE001 — السجل مايوقعش الطلب
            log.warning("document_versions: تعذّر حفظ نسخة %s", scope.get("path"), exc_info=True)

    def _write(self, scope, entity: str, doc_id: int, action: str, before, snap) -> None:
        db = SessionLocal()
        try:
            last = db.scalar(select(func.max(DocumentVersion.version_no)).where(
                DocumentVersion.entity_type == entity, DocumentVersion.entity_id == doc_id)) or 0
            num = (snap or {}).get("document_number") if isinstance(snap, dict) else None
            if last == 0 and before is not None and action != "create":
                last += 1
                db.add(DocumentVersion(
                    entity_type=entity, entity_id=doc_id, version_no=last, action="baseline",
                    document_number=(before.get("document_number") if isinstance(before, dict) else None),
                    actor_user_id=None, request_path=None, snapshot=before))
            db.add(DocumentVersion(
                entity_type=entity, entity_id=doc_id, version_no=last + 1, action=action[:40],
                document_number=(str(num)[:60] if num else None),
                actor_user_id=_actor_id(scope), request_path=scope.get("path", "")[:200],
                snapshot=snap))
            db.commit()
        except Exception:  # noqa: BLE001
            db.rollback()
            log.warning("document_versions: تعذّر الكتابة %s/%s", entity, doc_id, exc_info=True)
        finally:
            db.close()
