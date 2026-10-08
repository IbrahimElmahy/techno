from __future__ import annotations

import re
from datetime import date
from decimal import Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth import branch_scope
from src.auth.dependencies import CurrentUser
from src.models.coupon_custody import CouponCustody, CouponCustodySerial
from src.models.coupon_issue import CouponIssue, CouponIssueLine
from src.models.coupon_receipt import CouponReceipt, CouponReceiptLine
from src.models.customer import Customer
from src.models.sales import SalesInvoice, SalesInvoiceCoupon
from src.models.user import User

STATUSES = ("with_rep", "given", "received", "returned")
STATUS_LABELS = {
    "with_rep": "في العهدة",
    "given": "سُلِّم لتاجر",
    "received": "استُلم من سباك",
    "returned": "أُعيد للمكتب",
}
DATE_FIELDS = ("handout", "receipt")

DEFAULT_LIMIT = 50
MAX_LIMIT = 100_000
_MAX_RANGE = 20_000


class CouponLifecycleError(ValueError):
    pass


_KIND_LETTERS = str.maketrans({
    "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي", "ة": "ه", "ـ": "",
})
_ARABIC = re.compile(r"[؀-ۿ]")
_PREFIXED = re.compile(r"^\s*(\D*?)[\s\-–_/]*(\d+)\s*$")


def norm_kind(value) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    text = text.translate(_KIND_LETTERS)
    text = "".join(ch for ch in text if not ("ً" <= ch <= "ْ"))
    return " ".join(text.split()).casefold()


def _as_int(value) -> int | None:
    try:
        text = str(value).strip()
        return int(text) if text.isdigit() else None
    except (TypeError, ValueError):
        return None


def split_serial(kind, serial) -> tuple[str, str, str | None]:
    raw = str(serial or "").strip()
    shown_kind = (str(kind).strip() or None) if kind else None
    m = _PREFIXED.match(raw)
    if m and m.group(1) and _ARABIC.search(m.group(1)):
        shown_kind = shown_kind or m.group(1).strip()
        raw = m.group(2)
    number = _as_int(raw)
    return norm_kind(shown_kind), (str(number) if number is not None else raw), shown_kind


def _new_entry(kind_shown: str | None, number: str) -> dict:
    return {"kind": kind_shown, "serial": number,
            "custody": None, "handout": None, "receipt": None}


def _fill(target: dict, source: dict) -> None:
    target["kind"] = target["kind"] or source["kind"]
    for part in ("custody", "handout", "receipt"):
        if target[part] is None and source[part] is not None:
            target[part] = source[part]


def _money(value) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


_NOTE_PLUMBER = re.compile(r"^\s*الفني\s*[:：]\s*(.+?)\s*$")


def _plumber_from_notes(notes) -> str | None:
    m = _NOTE_PLUMBER.match(str(notes or "").splitlines()[0] if notes else "")
    return m.group(1) if m else None


def _receipt_counted_clause():
    status = getattr(CouponReceipt, "status", None)
    if status is None:
        return None
    return status.is_(None) | (status == "approved")


def collect(db: Session, current: CurrentUser) -> list[dict]:
    entries: dict[tuple[str, str], dict] = {}

    def entry(kind, serial) -> dict:
        k, n, shown = split_serial(kind, serial)
        e = entries.get((k, n))
        if e is None:
            e = entries[(k, n)] = _new_entry(shown, n)
        elif not e["kind"] and shown:
            e["kind"] = shown
        return e

    issue_heads: dict[int, dict] = {}
    for row in db.execute(branch_scope.scope(
            select(CouponIssue.id, CouponIssue.document_number, CouponIssue.issue_date,
                   CouponIssue.customer_id, CouponIssue.rep_user_id, CouponIssue.unit_value,
                   CouponIssue.coupon_kind)
            .where(CouponIssue.active.isnot(False)), CouponIssue, current)).all():
        issue_heads[row.id] = {
            "source": "issue", "doc_id": row.id, "doc": row.document_number,
            "date": row.issue_date, "party_id": row.customer_id, "rep_id": row.rep_user_id,
            "value": _money(row.unit_value), "kind": row.coupon_kind}

    invoice_heads: dict[int, dict] = {}

    def _invoice_head(row) -> dict:
        head = invoice_heads.get(row.id)
        if head is None:
            head = invoice_heads[row.id] = {
                "source": "invoice", "doc_id": row.id, "doc": row.document_number,
                "date": row.invoice_date, "party_id": row.customer_id, "rep_id": row.rep_id,
                "value": None, "kind": None}
        return head

    inv_cols = (SalesInvoice.id, SalesInvoice.document_number, SalesInvoice.invoice_date,
                SalesInvoice.customer_id, SalesInvoice.rep_id)

    custody_given: list[tuple[dict, int | None, int | None]] = []
    for row in db.execute(branch_scope.scope(
            select(CouponCustodySerial.coupon_kind, CouponCustodySerial.serial,
                   CouponCustodySerial.rep_user_id, CouponCustodySerial.status,
                   CouponCustodySerial.given_invoice_id, CouponCustodySerial.given_issue_id,
                   CouponCustody.document_number, CouponCustody.doc_date)
            .join(CouponCustody, CouponCustody.id == CouponCustodySerial.custody_id),
            CouponCustody, current)).all():
        e = entry(row.coupon_kind, row.serial)
        e["custody"] = {"rep_id": row.rep_user_id, "status": row.status,
                        "doc": row.document_number, "date": row.doc_date}
        if row.given_invoice_id or row.given_issue_id:
            custody_given.append((e, row.given_invoice_id, row.given_issue_id))

    for row in db.execute(branch_scope.scope(
            select(CouponIssueLine.coupon_kind, CouponIssueLine.serial, CouponIssueLine.issue_id)
            .join(CouponIssue, CouponIssue.id == CouponIssueLine.issue_id),
            CouponIssue, current)).all():
        head = issue_heads.get(row.issue_id)
        if head is None:
            continue
        e = entry(row.coupon_kind or head["kind"], row.serial)
        e["handout"] = e["handout"] or head

    ranges: list[tuple[dict, str | None, str | None, str | None]] = []
    for row in db.execute(branch_scope.scope(
            select(*inv_cols, SalesInvoiceCoupon.coupon_kind, SalesInvoiceCoupon.serial_from,
                   SalesInvoiceCoupon.serial_to)
            .join(SalesInvoiceCoupon, SalesInvoiceCoupon.invoice_id == SalesInvoice.id),
            SalesInvoice, current)).all():
        ranges.append((_invoice_head(row), row.coupon_kind, row.serial_from, row.serial_to))
    for row in db.execute(branch_scope.scope(
            select(*inv_cols, SalesInvoice.coupon_serial_from, SalesInvoice.coupon_serial_to)
            .where(SalesInvoice.coupon_serial_from.isnot(None)),
            SalesInvoice, current)).all():
        ranges.append((_invoice_head(row), None, row.coupon_serial_from, row.coupon_serial_to))
    for head, kind, first, last in ranges:
        lo, hi = _as_int(first), _as_int(last if last else first)
        if lo is not None and hi is not None and 0 <= hi - lo < _MAX_RANGE:
            serials = [str(n) for n in range(lo, hi + 1)]
        else:
            serials = [s for s in {first, last} if s]
        for serial in serials:
            e = entry(kind, serial)
            e["handout"] = e["handout"] or head

    stmt = (select(CouponReceiptLine.coupon_kind, CouponReceiptLine.serial,
                   CouponReceiptLine.sales_invoice_id, CouponReceiptLine.coupon_issue_id,
                   CouponReceipt.id, CouponReceipt.document_number, CouponReceipt.received_date,
                   CouponReceipt.customer_id, CouponReceipt.rep_user_id,
                   CouponReceipt.declared_value, CouponReceipt.declared_kind,
                   CouponReceipt.notes)
            .join(CouponReceipt, CouponReceipt.id == CouponReceiptLine.receipt_id))
    counted = _receipt_counted_clause()
    if counted is not None:
        stmt = stmt.where(counted)
    explicit: list[tuple[dict, int | None, int | None]] = []
    for row in db.execute(branch_scope.scope(stmt, CouponReceipt, current)).all():
        e = entry(row.coupon_kind, row.serial)
        receipt = {"doc_id": row.id, "doc": row.document_number, "date": row.received_date,
                   "party_id": row.customer_id, "rep_id": row.rep_user_id,
                   "value": _money(row.declared_value), "declared_kind": row.declared_kind,
                   "party_note": _plumber_from_notes(row.notes) if not row.customer_id else None}
        old = e["receipt"]
        if old is None or (receipt["date"] or date.min) >= (old["date"] or date.min):
            e["receipt"] = receipt
        if row.coupon_issue_id or row.sales_invoice_id:
            explicit.append((e, row.sales_invoice_id, row.coupon_issue_id))

    wanted = {inv for _, inv, _ in explicit + custody_given if inv} - set(invoice_heads)
    if wanted:
        for row in db.execute(branch_scope.scope(
                select(*inv_cols).where(SalesInvoice.id.in_(wanted)),
                SalesInvoice, current)).all():
            _invoice_head(row)

    for e, inv_id, issue_id in explicit:
        head = issue_heads.get(issue_id) if issue_id else None
        head = head or (invoice_heads.get(inv_id) if inv_id else None)
        if head is not None:
            e["handout"] = head
    for e, inv_id, issue_id in custody_given:
        if e["handout"] is None:
            e["handout"] = (issue_heads.get(issue_id) if issue_id else None) or (
                invoice_heads.get(inv_id) if inv_id else None)

    by_number: dict[str, list[tuple[str, str]]] = {}
    for key in entries:
        if key[0]:
            by_number.setdefault(key[1], []).append(key)
    for key in [k for k in entries if not k[0]]:
        mates = by_number.get(key[1], [])
        if len(mates) == 1:
            _fill(entries[mates[0]], entries.pop(key))

    return list(entries.values())


def _status_of(e: dict) -> str:
    if e["receipt"] is not None:
        return "received"
    if e["handout"] is not None:
        return "given"
    custody = e["custody"] or {}
    if custody.get("status") == "returned":
        return "returned"
    if custody.get("status") == "given":
        return "given"
    return "with_rep"


def _flatten(e: dict, users: dict[int, str], parties: dict[int, tuple[str, str | None]]) -> dict:
    custody = e["custody"] or {}
    handout = e["handout"] or {}
    receipt = e["receipt"] or {}
    party = parties.get(handout.get("party_id")) if handout else None
    plumber = parties.get(receipt.get("party_id")) if receipt else None
    value = receipt.get("value") if receipt.get("value") is not None else handout.get("value")
    status = _status_of(e)
    kind = e["kind"] or receipt.get("declared_kind") or handout.get("kind")
    return {
        "key": f"{norm_kind(kind)}|{e['serial']}",
        "serial": e["serial"],
        "kind": kind,
        "status": status,
        "status_label": STATUS_LABELS[status],
        "custody_rep_id": custody.get("rep_id"),
        "custody_rep": users.get(custody.get("rep_id")),
        "custody_doc": custody.get("doc"),
        "custody_date": custody.get("date"),
        "handout_source": handout.get("source"),
        "handout_doc_id": handout.get("doc_id"),
        "handout_doc": handout.get("doc"),
        "handout_date": handout.get("date"),
        "party_id": handout.get("party_id"),
        "party": party[0] if party else None,
        "party_type": party[1] if party else None,
        "handout_rep_id": handout.get("rep_id"),
        "handout_rep": users.get(handout.get("rep_id")),
        "receipt_id": receipt.get("doc_id"),
        "receipt_doc": receipt.get("doc"),
        "receipt_date": receipt.get("date"),
        "plumber_id": receipt.get("party_id"),
        "plumber": plumber[0] if plumber else receipt.get("party_note"),
        "receipt_rep_id": receipt.get("rep_id"),
        "receipt_rep": users.get(receipt.get("rep_id")),
        "value": value,
        "unlinked": status == "received" and not handout,
    }


def _serial_number(row: dict) -> int | None:
    return _as_int(row["serial"])


def lifecycle(
    db: Session,
    current: CurrentUser,
    *,
    date_field: str = "handout",
    date_from: date | None = None,
    date_to: date | None = None,
    rep_id: int | None = None,
    party_id: int | None = None,
    plumber_id: int | None = None,
    kind: str | None = None,
    status: str | None = None,
    serial: str | None = None,
    serial_from: str | None = None,
    serial_to: str | None = None,
    only_unlinked: bool = False,
    limit: int | None = None,
    offset: int = 0,
) -> dict:
    if date_field not in DATE_FIELDS:
        raise CouponLifecycleError(f"تاريخ غير معروف: {date_field}")
    if status and status not in STATUSES:
        raise CouponLifecycleError(f"حالة غير معروفة: {status}")
    lo = _as_int(serial_from) if serial_from else None
    hi = _as_int(serial_to) if serial_to else None
    if (serial_from and lo is None) or (serial_to and hi is None):
        raise CouponLifecycleError("يجب أن يكون نطاق الأرقام أرقاماً.")

    entries = collect(db, current)

    users = {u.id: (u.full_name or u.username)
             for u in db.execute(select(User.id, User.full_name, User.username)).all()}
    party_ids = {x for e in entries for x in (
        (e["handout"] or {}).get("party_id"), (e["receipt"] or {}).get("party_id")) if x}
    parties: dict[int, tuple[str, str | None]] = {}
    ids = list(party_ids)
    for i in range(0, len(ids), 5000):
        for c in db.execute(select(Customer.id, Customer.name, Customer.customer_type)
                            .where(Customer.id.in_(ids[i:i + 5000]))).all():
            parties[c.id] = (c.name, c.customer_type)

    rows = [_flatten(e, users, parties) for e in entries]

    date_key = "handout_date" if date_field == "handout" else "receipt_date"
    if date_from:
        rows = [r for r in rows if r[date_key] and r[date_key] >= date_from]
    if date_to:
        rows = [r for r in rows if r[date_key] and r[date_key] <= date_to]
    if rep_id:
        rows = [r for r in rows if rep_id in (
            r["custody_rep_id"], r["handout_rep_id"], r["receipt_rep_id"])]
    if party_id:
        rows = [r for r in rows if r["party_id"] == party_id]
    if plumber_id:
        rows = [r for r in rows if r["plumber_id"] == plumber_id]
    if kind:
        wanted_kind = norm_kind(kind)
        rows = [r for r in rows if norm_kind(r["kind"]) == wanted_kind]
    if serial and serial.strip():
        s_kind, s_num, _ = split_serial(None, serial)
        rows = [r for r in rows if r["serial"] == s_num
                and (not s_kind or norm_kind(r["kind"]) == s_kind)]
    if lo is not None or hi is not None:
        def _in_range(r: dict) -> bool:
            n = _serial_number(r)
            return n is not None and (lo is None or n >= lo) and (hi is None or n <= hi)
        rows = [r for r in rows if _in_range(r)]
    if only_unlinked:
        rows = [r for r in rows if r["unlinked"]]

    counts = {s: 0 for s in STATUSES}
    unlinked = 0
    for r in rows:
        counts[r["status"]] += 1
        unlinked += 1 if r["unlinked"] else 0
    value_total = sum((r["value"] for r in rows
                       if r["status"] == "received" and r["value"] is not None), Decimal("0"))
    if status:
        rows = [r for r in rows if r["status"] == status]

    def _last(r: dict) -> date:
        return max((d for d in (r["receipt_date"], r["handout_date"], r["custody_date"]) if d),
                   default=date.min)
    rows.sort(key=lambda r: (r[date_key] or date.min, _last(r), r["kind"] or "",
                             _serial_number(r) or 0), reverse=True)

    size = min(int(limit or DEFAULT_LIMIT), MAX_LIMIT)
    start = max(0, int(offset or 0))
    page = rows[start:start + size]
    return {
        "rows": page,
        "summary": {"total": sum(counts.values()), **counts, "unlinked": unlinked,
                    "shown": len(rows), "value_total": value_total},
        "page": {"limit": size, "offset": start, "total_rows": len(rows),
                 "truncated": start + len(page) < len(rows)},
    }
