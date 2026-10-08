from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.lib import report_statement

_SOURCES: list[tuple[str, str, str]] = [
    ("invoice", "src.models.sales:SalesInvoice", "/invoices"),
    ("return", "src.models.sales:SalesReturn", "/returns"),
    ("purchase", "src.models.purchasing:PurchaseInvoice", "/purchases"),
    ("purchase_return", "src.models.purchasing:PurchaseReturn", "/purchases"),
    ("voucher", "src.models.voucher:Voucher", "/vouchers"),
]


def _model(path: str):
    module, name = path.split(":")
    return getattr(__import__(module, fromlist=[name]), name)


def _rep_of(doc) -> int | None:
    return getattr(doc, "rep_id", None) or getattr(doc, "rep_user_id", None)


def _kind_value(k) -> str | None:
    if k is None:
        return None
    return str(getattr(k, "value", k))


def resolve_entry(db: Session, entry_id: int) -> dict | None:
    for kind, path, screen in _SOURCES:
        model = _model(path)
        column = getattr(model, "ledger_entry_id", None)
        if column is None:
            continue
        doc = db.scalar(select(model).where(column == entry_id))
        if doc is not None:
            return {
                "kind": kind,
                "id": doc.id,
                "document_number": getattr(doc, "document_number", None),
                "screen": screen,
                "rep_user_id": _rep_of(doc),
            }
    return None


def resolve_many(db: Session, entry_ids: list[int]) -> dict[int, dict]:
    wanted = {int(i) for i in entry_ids if i}
    if not wanted:
        return {}
    found: dict[int, dict] = {}
    for kind, path, screen in _SOURCES:
        model = _model(path)
        column = getattr(model, "ledger_entry_id", None)
        if column is None:
            continue
        remaining = wanted - found.keys()
        if not remaining:
            break
        for doc in db.scalars(select(model).where(column.in_(remaining))).all():
            found[int(doc.ledger_entry_id)] = {
                "kind": kind,
                "id": doc.id,
                "document_number": getattr(doc, "document_number", None),
                "screen": screen,
                "rep_user_id": _rep_of(doc),
                "statement": report_statement.text_of(doc),
                "origin_kind": getattr(doc, "origin_location_kind", None),
                "origin_id": getattr(doc, "origin_location_id", None),
                "family": getattr(doc, "family", None),
                "voucher_kind": (_kind_value(getattr(doc, "kind", None))
                                 if kind == "voucher" else None),
            }
    return found
