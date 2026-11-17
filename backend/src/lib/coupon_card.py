from __future__ import annotations

from collections import defaultdict
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth import branch_scope
from src.auth.dependencies import CurrentUser
from src.lib.coupon_lifecycle import _MAX_RANGE, _as_int, _receipt_counted_clause, norm_kind, split_serial
from src.models.coupon_issue import CouponIssue, CouponIssueLine
from src.models.coupon_receipt import CouponReceipt, CouponReceiptLine
from src.models.customer import Customer
from src.models.sales import SalesInvoice, SalesInvoiceCoupon
from src.models.user import User


def _ranges(numbers: list[str]) -> list[tuple[str, str]]:
    ints = sorted({n for n in (_as_int(s) for s in numbers) if n is not None})
    others = sorted({s for s in numbers if _as_int(s) is None})
    out: list[tuple[str, str]] = []
    start = prev = None
    for n in ints:
        if start is None:
            start = prev = n
        elif n == prev + 1:
            prev = n
        else:
            out.append((str(start), str(prev)))
            start = prev = n
    if start is not None:
        out.append((str(start), str(prev)))
    out.extend((s, s) for s in others)
    return out


def _range_text(ranges: list[tuple[str, str]]) -> str:
    return "، ".join(a if a == b else f"{a} - {b}" for a, b in ranges)


def card(db: Session, current: CurrentUser, *, kind: str | None = None,
         date_from: date | None = None, date_to: date | None = None,
         party_id: int | None = None, rep_id: int | None = None) -> dict:
    want_kind = norm_kind(kind) if kind else None
    moves: list[dict] = []

    def keep(row_kind) -> bool:
        return want_kind is None or norm_kind(row_kind) == want_kind

    issue_heads = {r.id: r for r in db.execute(branch_scope.scope(
        select(CouponIssue.id, CouponIssue.document_number, CouponIssue.issue_date,
               CouponIssue.customer_id, CouponIssue.rep_user_id, CouponIssue.coupon_kind,
               CouponIssue.unit_value)
        .where(CouponIssue.active.isnot(False)), CouponIssue, current)).all()}
    issue_serials: dict[tuple[int, str], list[str]] = defaultdict(list)
    for row in db.execute(branch_scope.scope(
            select(CouponIssueLine.issue_id, CouponIssueLine.coupon_kind, CouponIssueLine.serial)
            .join(CouponIssue, CouponIssue.id == CouponIssueLine.issue_id)
            .where(CouponIssue.active.isnot(False)), CouponIssue, current)).all():
        head = issue_heads.get(row.issue_id)
        k, number, shown = split_serial(row.coupon_kind or (head.coupon_kind if head else None),
                                        row.serial)
        issue_serials[(row.issue_id, shown or (head.coupon_kind if head else "") or "")].append(number)
    for (issue_id, k), serials in issue_serials.items():
        head = issue_heads[issue_id]
        if not keep(k):
            continue
        moves.append({"source": "issue", "type": "صرف كوبونات", "doc_id": issue_id,
                      "doc": head.document_number, "date": head.issue_date,
                      "party_id": head.customer_id, "rep_id": head.rep_user_id, "kind": k,
                      "value": head.unit_value, "issued": len(serials), "received": 0,
                      "ranges": _ranges(serials)})

    inv_rows = db.execute(branch_scope.scope(
        select(SalesInvoice.id, SalesInvoice.document_number, SalesInvoice.invoice_date,
               SalesInvoice.customer_id, SalesInvoice.rep_id, SalesInvoiceCoupon.coupon_kind,
               SalesInvoiceCoupon.count, SalesInvoiceCoupon.serial_from,
               SalesInvoiceCoupon.serial_to)
        .join(SalesInvoiceCoupon, SalesInvoiceCoupon.invoice_id == SalesInvoice.id),
        SalesInvoice, current)).all()
    for row in inv_rows:
        if not keep(row.coupon_kind):
            continue
        lo = _as_int(row.serial_from)
        hi = _as_int(row.serial_to or row.serial_from)
        if lo is not None and hi is not None and 0 <= hi - lo < _MAX_RANGE:
            count = hi - lo + 1
            ranges = [(str(lo), str(hi))]
        else:
            count = int(row.count or 0)
            ranges = [(row.serial_from, row.serial_to or row.serial_from)] if row.serial_from else []
        moves.append({"source": "invoice", "type": "فاتورة بيع", "doc_id": row.id,
                      "doc": row.document_number, "date": row.invoice_date,
                      "party_id": row.customer_id, "rep_id": row.rep_id,
                      "kind": row.coupon_kind or "", "value": None,
                      "issued": count, "received": 0, "ranges": ranges})

    rec_stmt = (select(CouponReceipt.id, CouponReceipt.document_number,
                       CouponReceipt.received_date, CouponReceipt.customer_id,
                       CouponReceipt.rep_user_id, CouponReceipt.actor_user_id,
                       CouponReceipt.declared_kind, CouponReceipt.declared_value,
                       CouponReceiptLine.coupon_kind, CouponReceiptLine.serial)
                .join(CouponReceiptLine, CouponReceiptLine.receipt_id == CouponReceipt.id))
    counted = _receipt_counted_clause()
    if counted is not None:
        rec_stmt = rec_stmt.where(counted)
    rec_heads: dict[int, object] = {}
    rec_serials: dict[tuple[int, str], list[str]] = defaultdict(list)
    for row in db.execute(branch_scope.scope(rec_stmt, CouponReceipt, current)).all():
        rec_heads[row.id] = row
        _k, number, shown = split_serial(row.coupon_kind or row.declared_kind, row.serial)
        rec_serials[(row.id, shown or row.declared_kind or "")].append(number)
    for (rid, k), serials in rec_serials.items():
        head = rec_heads[rid]
        if not keep(k):
            continue
        moves.append({"source": "receipt", "type": "استلام كوبونات", "doc_id": rid,
                      "doc": head.document_number, "date": head.received_date,
                      "party_id": head.customer_id,
                      "rep_id": head.rep_user_id or head.actor_user_id, "kind": k,
                      "value": head.declared_value, "issued": 0, "received": len(serials),
                      "ranges": _ranges(serials)})

    if party_id is not None:
        moves = [m for m in moves if m["party_id"] == party_id]
    if rep_id is not None:
        moves = [m for m in moves if m["rep_id"] == rep_id]

    moves.sort(key=lambda m: (m["date"] or date.min, 0 if m["issued"] else 1, m["doc"] or ""))
    opening_issued = sum(m["issued"] for m in moves if date_from and (m["date"] or date.min) < date_from)
    opening_received = sum(m["received"] for m in moves if date_from and (m["date"] or date.min) < date_from)
    shown = [m for m in moves
             if not (date_from and (m["date"] or date.min) < date_from)
             and not (date_to and m["date"] and m["date"] > date_to)]

    party_ids = {m["party_id"] for m in shown if m["party_id"]}
    rep_ids = {m["rep_id"] for m in shown if m["rep_id"]}
    parties = {r.id: (r.name, r.customer_type) for r in db.execute(
        select(Customer.id, Customer.name, Customer.customer_type)
        .where(Customer.id.in_(party_ids))).all()} if party_ids else {}
    reps = {r.id: (r.full_name or r.username) for r in db.execute(
        select(User.id, User.full_name, User.username).where(User.id.in_(rep_ids))).all()} if rep_ids else {}

    balance = opening_issued - opening_received
    rows = []
    for i, m in enumerate(shown):
        balance += m["issued"] - m["received"]
        party = parties.get(m["party_id"])
        first, last = (m["ranges"][0][0], m["ranges"][-1][1]) if m["ranges"] else (None, None)
        rows.append({
            "key": f"{m['source']}-{m['doc_id']}-{i}",
            "source": m["source"], "type": m["type"], "doc_id": m["doc_id"], "doc": m["doc"],
            "date": m["date"].isoformat() if m["date"] else None,
            "party_id": m["party_id"], "party": party[0] if party else None,
            "party_type": party[1] if party else None,
            "rep_id": m["rep_id"], "rep": reps.get(m["rep_id"]),
            "kind": m["kind"] or None, "value": str(m["value"]) if m["value"] is not None else None,
            "issued": m["issued"], "received": m["received"],
            "serial_from": first, "serial_to": last, "ranges": _range_text(m["ranges"]),
            "balance": balance,
        })

    issued = sum(r["issued"] for r in rows)
    received = sum(r["received"] for r in rows)
    kinds = sorted({m["kind"] for m in moves if m["kind"]})
    return {
        "rows": rows,
        "opening": opening_issued - opening_received,
        "totals": {"issued": issued, "received": received,
                   "closing": opening_issued - opening_received + issued - received},
        "kinds": kinds,
    }
