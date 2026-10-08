from __future__ import annotations

import logging

from src.core.db import SessionLocal
from src.core.security import decode_access_token
from src.models.audit import AuditLogEntry

log = logging.getLogger(__name__)

_SKIP_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
_SKIP_PATHS = frozenset({"/api/v1/auth/login", "/api/v1/auth/refresh",
                         "/api/v1/live/ticket"})
_VERB = {"POST": "create", "PUT": "update", "PATCH": "update", "DELETE": "delete"}


def _actor_id(scope) -> int | None:
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


_ENTITY = {
    "transfers": "stock_transfer",
    "sales": "sales_invoice",
    "purchases": "purchase_invoice",
    "warehouses": "warehouse",
    "users": "user",
    "vouchers": "voucher",
    "inspections": "inspection",
    "customers": "customer",
    "suppliers": "supplier",
    "items": "item",
    "branches": "branch",
    "employees": "employee",
    "cheques": "cheque",
    "coupons": "coupon",
    "coupon-receipts": "coupon_receipt",
    "custodies": "custody",
    "treasuries": "treasury",
    "journal-entries": "ledger_entry",
    "accounts": "account",
    "journals": "journal",
    "reservations": "reservation",
    "stock-counts": "stock_count",
    "cost-centers": "cost_center",
    "fixed-assets": "fixed_asset",
    "governorates": "governorate",
    "territories": "territory",
    "job-titles": "job_title",
    "commission-rules": "commission_rule",
    "orders": "manufacturing_order",
    "wastage": "wastage_document",
    "stock": "stock_permit",
    "reps": "user",
}


def _describe(path: str, method: str) -> tuple[str, str | None, int | None]:
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
    return action[:60], _ENTITY.get(resource, resource)[:40], entity_id


class RequestAuditMiddleware:
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
        except Exception:  # noqa: BLE001
            db.rollback()
            log.warning("audit: تعذّر تسجيل %s %s", method, path, exc_info=True)
        finally:
            db.close()
