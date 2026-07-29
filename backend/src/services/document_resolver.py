"""Which document produced this ledger entry?

A statement line says «بيع 1,559.70» and, until now, that was the end of the trail: the reader
could see the amount and not the invoice. The entry does not name its document — documents name
their entry — so the answer is found by asking each document type which one claims it.

That is deliberately a lookup rather than a column on the entry. The ledger is append-only and
shared by every module; adding a polymorphic document reference to it would mean every new
document type had to teach the ledger about itself, and a wrong value there would be unfixable.
Asking the documents instead keeps the ledger ignorant of them, which is why it has survived
eight modules without a schema change.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

# (kind, model, screen) — the kind is what the UI's DocumentLink understands.
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


def resolve_entry(db: Session, entry_id: int) -> dict | None:
    """The document that posted this entry, or None for a hand-written journal entry.

    None is a real answer, not a failure: a manual journal entry has no document behind it, and
    saying so is more useful than an empty result the reader has to interpret.
    """
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
            }
    return None


def resolve_many(db: Session, entry_ids: list[int]) -> dict[int, dict]:
    """Resolve a whole statement in one pass per document type rather than one per line.

    A statement can run to hundreds of lines; asking five questions per line would make opening
    it slower than reading it.
    """
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
            }
    return found
