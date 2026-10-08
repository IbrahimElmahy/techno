from __future__ import annotations

from datetime import date, datetime

from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from src.lib.doc_order import newest_first
from src.auth.branch_scope import branch_for
from src.models.coupon_issue import CouponIssue, CouponIssueLine
from src.models.coupon_receipt import CouponReceipt, CouponReceiptLine, receipt_counted
from src.models.sales import SalesInvoice, SalesInvoiceCoupon
from src.services import audit_service, numbering


class CouponReceiptError(Exception):
    pass


class CouponReceiptConflict(CouponReceiptError):
    pass


def _as_int(value) -> int | None:
    try:
        text = str(value).strip()
        return int(text) if text and str(int(text)) == text else None
    except (TypeError, ValueError):
        return None


_KIND_LETTERS = str.maketrans({
    "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي", "ة": "ه", "ـ": "",
})


def _norm_kind(value) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    text = text.translate(_KIND_LETTERS)
    text = "".join(ch for ch in text if not ("ً" <= ch <= "ْ"))
    return " ".join(text.split()).casefold()


def _same_kind(left, right) -> bool:
    left_norm, right_norm = _norm_kind(left), _norm_kind(right)
    return bool(left_norm) and left_norm == right_norm


def _kindless_invoice(db: Session, serial: str) -> SalesInvoice | None:
    exact = db.scalar(
        select(SalesInvoice).where(
            (SalesInvoice.coupon_serial_from == serial)
            | (SalesInvoice.coupon_serial_to == serial)
        )
    )
    if exact is not None:
        return exact
    endpoint_rows = db.scalars(
        select(SalesInvoiceCoupon).where(
            (SalesInvoiceCoupon.serial_from == serial)
            | (SalesInvoiceCoupon.serial_to == serial)
        )
    ).all()
    for row in endpoint_rows:
        if not row.coupon_kind:
            return db.get(SalesInvoice, row.invoice_id)
    number = _as_int(serial)
    if number is None:
        return None
    candidates = db.scalars(
        select(SalesInvoice).where(SalesInvoice.coupon_serial_from.isnot(None))
    ).all()
    for invoice in candidates:
        first = _as_int(invoice.coupon_serial_from)
        last = _as_int(invoice.coupon_serial_to)
        if first is None or last is None:
            continue
        if first <= number <= last:
            return invoice
    ranged = db.scalars(
        select(SalesInvoiceCoupon).where(SalesInvoiceCoupon.serial_from.isnot(None))
    ).all()
    for row in ranged:
        if row.coupon_kind:
            continue
        first, last = _as_int(row.serial_from), _as_int(row.serial_to)
        if first is None or last is None:
            continue
        if first <= number <= last:
            return db.get(SalesInvoice, row.invoice_id)
    return None


def invoice_match(db: Session, serial: str,
                  coupon_kind: str | None = None) -> tuple[SalesInvoice | None, bool]:
    serial = str(serial).strip()
    if not serial:
        return None, False
    wanted = _norm_kind(coupon_kind)
    number = _as_int(serial)

    if not wanted:
        exact = db.scalar(
            select(SalesInvoice).where(
                (SalesInvoice.coupon_serial_from == serial)
                | (SalesInvoice.coupon_serial_to == serial)
            )
        )
        if exact is not None:
            return exact, True
        exact_row = db.scalar(
            select(SalesInvoiceCoupon).where(
                (SalesInvoiceCoupon.serial_from == serial)
                | (SalesInvoiceCoupon.serial_to == serial)
            )
        )
        if exact_row is not None:
            return db.get(SalesInvoice, exact_row.invoice_id), not exact_row.coupon_kind
        if number is not None:
            candidates = db.scalars(
                select(SalesInvoice).where(SalesInvoice.coupon_serial_from.isnot(None))
            ).all()
            for invoice in candidates:
                first = _as_int(invoice.coupon_serial_from)
                last = _as_int(invoice.coupon_serial_to)
                if first is None or last is None:
                    continue
                if first <= number <= last:
                    return invoice, True
            ranged = db.scalars(
                select(SalesInvoiceCoupon).where(SalesInvoiceCoupon.serial_from.isnot(None))
            ).all()
            for row in ranged:
                first, last = _as_int(row.serial_from), _as_int(row.serial_to)
                if first is None or last is None:
                    continue
                if first <= number <= last:
                    return db.get(SalesInvoice, row.invoice_id), not row.coupon_kind
        return None, False

    endpoint_rows = db.scalars(
        select(SalesInvoiceCoupon).where(
            (SalesInvoiceCoupon.serial_from == serial)
            | (SalesInvoiceCoupon.serial_to == serial)
        )
    ).all()
    for row in endpoint_rows:
        if _same_kind(row.coupon_kind, coupon_kind):
            return db.get(SalesInvoice, row.invoice_id), False
    if number is not None:
        ranged = db.scalars(
            select(SalesInvoiceCoupon).where(SalesInvoiceCoupon.serial_from.isnot(None))
        ).all()
        for row in ranged:
            if not _same_kind(row.coupon_kind, coupon_kind):
                continue
            first, last = _as_int(row.serial_from), _as_int(row.serial_to)
            if first is None or last is None:
                continue
            if first <= number <= last:
                return db.get(SalesInvoice, row.invoice_id), False

    kindless = _kindless_invoice(db, serial)
    return (kindless, True) if kindless is not None else (None, False)


def find_issuing_invoice(db: Session, serial: str,
                         coupon_kind: str | None = None) -> SalesInvoice | None:
    return invoice_match(db, serial, coupon_kind)[0]


def already_received(db: Session, serial: str,
                     coupon_kind: str | None = None) -> CouponReceiptLine | None:
    rows = db.scalars(
        select(CouponReceiptLine).where(CouponReceiptLine.serial == str(serial).strip())
    ).all()
    if not rows:
        return None
    if not coupon_kind:
        return rows[0]
    for row in rows:
        if not row.coupon_kind or _same_kind(row.coupon_kind, coupon_kind):
            return row
    return None


def issue_match(db: Session, serial: str,
                coupon_kind: str | None = None) -> tuple[CouponIssue | None, bool]:
    rows = db.scalars(
        select(CouponIssueLine).where(CouponIssueLine.serial == str(serial).strip())
    ).all()
    if not rows:
        return None, False
    if not coupon_kind:
        row = rows[0]
        return db.get(CouponIssue, row.issue_id), not row.coupon_kind
    for row in rows:
        if _same_kind(row.coupon_kind, coupon_kind):
            return db.get(CouponIssue, row.issue_id), False
    for row in rows:
        if not row.coupon_kind:
            return db.get(CouponIssue, row.issue_id), True
    return None, False


def find_issuing_issue(db: Session, serial: str,
                       coupon_kind: str | None = None) -> CouponIssue | None:
    return issue_match(db, serial, coupon_kind)[0]


def kinds_for_serials(db: Session, serials: list[str]) -> dict[str, list[str]]:
    wanted = {str(s).strip() for s in serials if str(s).strip()}
    if not wanted:
        return {}
    numbers = {s: _as_int(s) for s in wanted}
    found: dict[str, dict[str, str]] = {s: {} for s in wanted}

    for row in db.scalars(select(CouponIssueLine)).all():
        if row.coupon_kind and row.serial in found:
            found[row.serial].setdefault(_norm_kind(row.coupon_kind), row.coupon_kind)

    for row in db.scalars(select(SalesInvoiceCoupon)).all():
        if not row.coupon_kind:
            continue
        key = _norm_kind(row.coupon_kind)
        first, last = _as_int(row.serial_from), _as_int(row.serial_to)
        for serial in wanted:
            if serial in (row.serial_from, row.serial_to):
                found[serial].setdefault(key, row.coupon_kind)
                continue
            number = numbers[serial]
            if first is None or last is None or number is None:
                continue
            if first <= number <= last:
                found[serial].setdefault(key, row.coupon_kind)

    return {serial: sorted(kinds.values()) for serial, kinds in found.items()}


def kinds_for_serial(db: Session, serial: str) -> list[str]:
    return kinds_for_serials(db, [serial]).get(str(serial).strip(), [])


def check_serial(db: Session, serial: str, coupon_kind: str | None = None) -> dict:
    serial = str(serial).strip()
    invoice, kindless = invoice_match(db, serial, coupon_kind)
    issue = None
    if invoice is None:
        issue, kindless = issue_match(db, serial, coupon_kind)
    known = invoice is not None or issue is not None
    taken = already_received(db, serial, None if kindless else coupon_kind)
    status = "valid" if known and not taken else ("received" if taken else "unknown")

    issued_to_id = (invoice.customer_id if invoice is not None
                    else issue.customer_id if issue is not None else None)
    issued_to_name = None
    if issued_to_id:
        from src.models.customer import Customer

        owner = db.get(Customer, issued_to_id)
        issued_to_name = owner.name if owner else None

    kinds = kinds_for_serial(db, serial)
    resolved = coupon_kind or (kinds[0] if len(kinds) == 1 else None)
    if len(kinds) > 1 and coupon_kind is None:
        status = "ambiguous"
    if (status == "unknown" and coupon_kind and kinds
            and not any(_same_kind(k, coupon_kind) for k in kinds)):
        status = "wrong_kind"
    from src.services import coupon_custody_service

    held = coupon_custody_service.held_serials(db, [serial], coupon_kind)
    custody_rep_name = None
    if held:
        status = "unknown"
        rid = next(iter(held.values()))
        custody_rep_name = coupon_custody_service.rep_name(db, rid)
    return {
        "in_custody": bool(held),
        "custody_rep_name": custody_rep_name,
        "serial": serial,
        "status": status,
        "coupon_kind": resolved,
        "kinds": kinds,
        "sales_invoice_id": invoice.id if invoice else None,
        "coupon_issue_id": issue.id if issue else None,
        "document_number": (invoice.document_number if invoice
                            else issue.document_number if issue else None),
        "issued_to_id": issued_to_id,
        "issued_to_name": issued_to_name,
        "customer_id": issued_to_id,
        "customer_name": issued_to_name,
        "received_receipt_id": taken.receipt_id if taken else None,
        "received_pending": bool(taken) and _receipt_pending(db, taken.receipt_id),
    }


def _receipt_pending(db: Session, receipt_id: int) -> bool:
    owner = db.get(CouponReceipt, receipt_id)
    return owner is not None and (owner.status or "approved") == "pending"


def expand_range(serial_from: str, serial_to: str | None) -> list[str]:
    serial_from = str(serial_from or "").strip()
    serial_to = str(serial_to or "").strip()
    if not serial_from:
        serial_from = serial_to
    if not serial_from:
        return []
    if not serial_to or serial_to == serial_from:
        return [serial_from]
    first, last = _as_int(serial_from), _as_int(serial_to)
    if first is None or last is None:
        raise CouponReceiptError("النطاق لازم يكون أرقام عشان يتفك؛ أدخل الكوبونات واحد واحد.")
    if last < first:
        raise CouponReceiptError("رقم النهاية أصغر من رقم البداية.")
    if last - first + 1 > 500:
        raise CouponReceiptError("النطاق كبير جداً — أقصى ٥٠٠ كوبون في الاستلام الواحد.")
    return [str(n) for n in range(first, last + 1)]


def _doc_number(db: Session) -> str:
    return numbering.next_document_number(db, CouponReceipt, "CR")


PENDING = "pending"
APPROVED = "approved"
REJECTED = "rejected"


def status_of(receipt: CouponReceipt) -> str:
    return receipt.status or APPROVED


def approved_clause():
    return receipt_counted()


def _match_serials(
    db: Session, cleaned: list[str], coupon_kind: str | None,
) -> list[tuple[str, SalesInvoice | None, CouponIssue | None, str | None]]:
    if not cleaned:
        raise CouponReceiptError("مافيش كوبونات في الاستلام.")
    duplicates = {s for s in cleaned if cleaned.count(s) > 1}
    if duplicates:
        raise CouponReceiptError(f"كوبونات مكرّرة في نفس الاستلام: {', '.join(sorted(duplicates))}")

    from src.services import coupon_custody_service

    held = coupon_custody_service.held_serials(db, cleaned, coupon_kind)
    if held:
        raise CouponReceiptError(
            coupon_custody_service.held_message(db, held, coupon_kind))

    matched: list[tuple[str, SalesInvoice | None, CouponIssue | None, str | None]] = []
    unknown: list[str] = []
    seen_before: list[str] = []
    wrong_kind: list[str] = []
    kind_map = kinds_for_serials(db, cleaned) if coupon_kind else {}
    for serial in cleaned:
        invoice, kindless = invoice_match(db, serial, coupon_kind)
        issue = None
        if invoice is None:
            issue, kindless = issue_match(db, serial, coupon_kind)
        if invoice is None and issue is None:
            other = kind_map.get(serial) or []
            if coupon_kind and other and not any(_same_kind(k, coupon_kind) for k in other):
                wrong_kind.append(f"{serial} (موجود تحت: {'، '.join(other)})")
            else:
                unknown.append(serial)
            continue
        line_kind = None if kindless else coupon_kind
        taken = already_received(db, serial, line_kind)
        if taken is not None:
            owner = db.get(CouponReceipt, taken.receipt_id)
            if owner is not None and status_of(owner) == PENDING:
                seen_before.append(f"{serial} (بانتظار الاعتماد في {owner.document_number})")
            elif owner is not None:
                seen_before.append(f"{serial} ({owner.document_number})")
            else:
                seen_before.append(serial)
            continue
        matched.append((serial, invoice, issue, line_kind))

    if unknown:
        raise CouponReceiptError(
            f"كوبونات مش متصرّفة من النظام: {', '.join(unknown)}")
    if wrong_kind:
        raise CouponReceiptError(
            f"كوبونات مش متصرّفة تحت فئة «{coupon_kind}»: {', '.join(wrong_kind)}")
    if seen_before:
        raise CouponReceiptError(
            f"كوبونات اتستلمت قبل كده: {', '.join(seen_before)}")
    return matched


def _write_lines(db: Session, receipt: CouponReceipt, matched) -> None:
    for serial, invoice, issue, line_kind in matched:
        db.add(CouponReceiptLine(
            receipt_id=receipt.id, serial=serial,
            sales_invoice_id=invoice.id if invoice else None,
            coupon_issue_id=issue.id if issue else None,
            coupon_kind=line_kind))
    db.flush()


def create_receipt(
    db: Session, *, serials: list[str], actor_user_id: int,
    customer_id: int | None = None, rep_user_id: int | None = None,
    received_date: date | None = None, notes: str | None = None,
    declared_kind: str | None = None, declared_value: object | None = None,
    customer_type: str | None = None,
    client_uuid: str | None = None,
    coupon_kind: str | None = None,
    pending: bool = False,
    source: str | None = None,
) -> CouponReceipt:
    if client_uuid:
        existing = db.scalar(
            select(CouponReceipt).options(selectinload(CouponReceipt.lines))
            .where(CouponReceipt.client_uuid == client_uuid))
        if existing is not None:
            return existing

    cleaned = [str(s).strip() for s in serials if str(s).strip()]
    matched = _match_serials(db, cleaned, coupon_kind)

    receipt = CouponReceipt(
        document_number=_doc_number(db), customer_id=customer_id, rep_user_id=rep_user_id,
        received_date=received_date, coupon_count=len(matched), notes=notes,
        declared_kind=declared_kind, declared_value=declared_value,
        customer_type=customer_type,
        client_uuid=client_uuid, actor_user_id=actor_user_id,
        branch_id=branch_for(db, actor_user_id=actor_user_id,
                             location_kind="rep", location_id=rep_user_id),
        status=PENDING if pending else APPROVED,
        source=source,
    )
    if not pending:
        receipt.approved_by = actor_user_id
        receipt.approved_at = datetime.utcnow()
    db.add(receipt)
    db.flush()
    _write_lines(db, receipt, matched)

    audit_service.record(
        db, action="coupon_receipt.create", actor_user_id=actor_user_id,
        entity_type="coupon_receipt", entity_id=receipt.id,
        after={"doc": receipt.document_number, "count": len(matched),
               "status": receipt.status},
    )
    return receipt


def _load(db: Session, receipt_id: int) -> CouponReceipt:
    receipt = db.scalar(
        select(CouponReceipt).options(selectinload(CouponReceipt.lines))
        .where(CouponReceipt.id == receipt_id))
    if receipt is None:
        raise CouponReceiptError("الاستلام ده مش موجود.")
    return receipt


def approve_receipt(db: Session, *, receipt_id: int, actor_user_id: int) -> CouponReceipt:
    receipt = _load(db, receipt_id)
    if status_of(receipt) != PENDING:
        raise CouponReceiptConflict("الاستلام ده مش بانتظار الاعتماد.")
    if not receipt.lines:
        raise CouponReceiptConflict("الاستلام ده مافيهوش كوبونات — عدّله أو احذفه.")
    receipt.status = APPROVED
    receipt.approved_by = actor_user_id
    receipt.approved_at = datetime.utcnow()
    db.flush()
    audit_service.record(
        db, action="coupon_receipt.approve", actor_user_id=actor_user_id,
        entity_type="coupon_receipt", entity_id=receipt.id,
        after={"doc": receipt.document_number, "count": len(receipt.lines)},
    )
    return receipt


def reject_receipt(db: Session, *, receipt_id: int, actor_user_id: int,
                   reason: str | None = None) -> CouponReceipt:
    receipt = _load(db, receipt_id)
    if status_of(receipt) != PENDING:
        raise CouponReceiptConflict("الاستلام ده مش بانتظار الاعتماد.")
    serials = [line.serial for line in receipt.lines]
    receipt.rejected_serials = ",".join(serials) or None
    receipt.lines.clear()
    receipt.status = REJECTED
    receipt.approved_by = actor_user_id
    receipt.approved_at = datetime.utcnow()
    receipt.reject_reason = (reason or "").strip()[:240] or None
    db.flush()
    audit_service.record(
        db, action="coupon_receipt.reject", actor_user_id=actor_user_id,
        entity_type="coupon_receipt", entity_id=receipt.id,
        after={"doc": receipt.document_number, "serials": serials,
               "reason": receipt.reject_reason},
    )
    return receipt


def update_receipt(
    db: Session, *, receipt_id: int, actor_user_id: int, serials: list[str],
    coupon_kind: str | None = None, customer_id: int | None = None,
    received_date: date | None = None, notes: str | None = None,
    declared_value: object | None = None, customer_type: str | None = None,
) -> CouponReceipt:
    receipt = _load(db, receipt_id)
    if status_of(receipt) == REJECTED:
        raise CouponReceiptConflict("الاستلام المرفوض مابيتعدّلش — سجّل استلام جديد.")
    before = {"serials": sorted(line.serial for line in receipt.lines),
              "kind": receipt.declared_kind, "customer_id": receipt.customer_id}
    receipt.lines.clear()
    db.flush()

    cleaned = [str(s).strip() for s in serials if str(s).strip()]
    kind = coupon_kind if coupon_kind else receipt.declared_kind
    matched = _match_serials(db, cleaned, kind)
    _write_lines(db, receipt, matched)

    receipt.coupon_count = len(matched)
    receipt.declared_kind = kind
    if customer_id is not None:
        receipt.customer_id = customer_id
    if received_date is not None:
        receipt.received_date = received_date
    receipt.notes = notes
    if declared_value is not None:
        receipt.declared_value = declared_value
    if customer_type is not None:
        receipt.customer_type = customer_type
    db.flush()
    db.refresh(receipt)
    audit_service.record(
        db, action="coupon_receipt.update", actor_user_id=actor_user_id,
        entity_type="coupon_receipt", entity_id=receipt.id,
        before=before,
        after={"serials": sorted(s for s, *_ in matched), "kind": kind,
               "customer_id": receipt.customer_id},
    )
    return receipt


def _status_where(stmt, status: str | None):
    if status == APPROVED:
        return stmt.where(approved_clause())
    if status in (PENDING, REJECTED):
        return stmt.where(CouponReceipt.status == status)
    return stmt


def _build_receipts_stmt(
    *, customer_id: int | None = None, rep_user_id: int | None = None,
    q: str | None = None, status: str | None = None,
):
    stmt = _status_where(select(CouponReceipt), status)
    if customer_id:
        stmt = stmt.where(CouponReceipt.customer_id == customer_id)
    if rep_user_id:
        stmt = stmt.where(CouponReceipt.rep_user_id == rep_user_id)
    if q:
        q_str = q.strip()
        from src.models.customer import Customer
        from sqlalchemy import or_, exists
        line_match = select(1).where(
            CouponReceiptLine.receipt_id == CouponReceipt.id,
            CouponReceiptLine.serial.contains(q_str)
        )
        cust_match = select(1).where(
            Customer.id == CouponReceipt.customer_id,
            Customer.name.contains(q_str)
        )
        conds = [
            CouponReceipt.document_number.contains(q_str),
            CouponReceipt.notes.contains(q_str),
            exists(line_match),
            exists(cust_match),
        ]
        stmt = stmt.where(or_(*conds))
    return stmt


def list_receipts(
    db: Session, *, customer_id: int | None = None, rep_user_id: int | None = None,
    q: str | None = None, limit: int | None = None, offset: int = 0,
    status: str | None = None,
) -> tuple[list[CouponReceipt], int]:
    base_stmt = _build_receipts_stmt(customer_id=customer_id, rep_user_id=rep_user_id, q=q,
                                     status=status)
    total_count = db.scalar(select(func.count()).select_from(base_stmt.order_by(None).subquery())) or 0

    query = base_stmt.options(selectinload(CouponReceipt.lines)).order_by(*newest_first(CouponReceipt, CouponReceipt.received_date))
    if limit is not None:
        query = query.limit(min(limit, 500)).offset(offset)
    return list(db.scalars(query).all()), total_count


def coupon_receipts_summary(
    db: Session, *, customer_id: int | None = None, rep_user_id: int | None = None,
    q: str | None = None, status: str | None = None,
) -> dict:
    base_stmt = _build_receipts_stmt(customer_id=customer_id, rep_user_id=rep_user_id, q=q,
                                     status=status or APPROVED)
    subq = base_stmt.order_by(None).subquery()
    summary_stmt = select(
        func.count(subq.c.id).label("total_receipts"),
        func.coalesce(func.sum(subq.c.coupon_count), 0).label("total_coupons"),
        func.coalesce(func.sum(subq.c.declared_value * subq.c.coupon_count), Decimal("0.00")).label("total_value"),
    )
    row = db.execute(summary_stmt).one()
    kind_stmt = select(
        subq.c.declared_kind,
        func.coalesce(func.sum(subq.c.coupon_count), 0).label("cnt")
    ).where(subq.c.declared_kind.isnot(None)).group_by(subq.c.declared_kind)
    kind_counts = {r[0]: int(r[1]) for r in db.execute(kind_stmt).all() if r[0]}

    all_subq = _build_receipts_stmt(
        customer_id=customer_id, rep_user_id=rep_user_id, q=q).order_by(None).subquery()
    status_counts = {PENDING: 0, APPROVED: 0, REJECTED: 0}
    for st, cnt in db.execute(select(all_subq.c.status, func.count())
                              .group_by(all_subq.c.status)).all():
        key = st or APPROVED
        status_counts[key] = status_counts.get(key, 0) + int(cnt)

    return {
        "status_counts": status_counts,
        "total_receipts": int(row.total_receipts or 0),
        "total_coupons": int(row.total_coupons or 0),
        "total_value": Decimal(str(row.total_value or 0)),
        "kind_counts": kind_counts,
    }


def get_receipt(db: Session, receipt_id: int) -> CouponReceipt:
    receipt = db.scalar(
        select(CouponReceipt).options(selectinload(CouponReceipt.lines))
        .where(CouponReceipt.id == receipt_id))
    if receipt is None:
        raise CouponReceiptError("الاستلام غير موجود.")
    return receipt


def issued_to_customer(db: Session, customer_id: int) -> list[dict]:
    invoices = db.scalars(
        select(SalesInvoice).where(SalesInvoice.customer_id == customer_id)
    ).all()
    if not invoices:
        return []
    by_id = {inv.id: inv for inv in invoices}

    rows = db.scalars(
        select(SalesInvoiceCoupon).where(SalesInvoiceCoupon.invoice_id.in_(by_id))
    ).all()
    with_rows = {r.invoice_id for r in rows}

    books: list[dict] = []
    for r in rows:
        inv = by_id[r.invoice_id]
        books.append({
            "invoice_id": inv.id, "document_number": inv.document_number,
            "invoice_date": str(inv.invoice_date) if inv.invoice_date else None,
            "coupon_kind": r.coupon_kind,
            "count": r.count, "serial_from": r.serial_from, "serial_to": r.serial_to,
        })
    for inv in invoices:
        if inv.id in with_rows or not inv.coupon_count:
            continue
        books.append({
            "invoice_id": inv.id, "document_number": inv.document_number,
            "invoice_date": str(inv.invoice_date) if inv.invoice_date else None,
            "coupon_kind": None,
            "count": inv.coupon_count,
            "serial_from": inv.coupon_serial_from, "serial_to": inv.coupon_serial_to,
        })

    for book in books:
        serials = (expand_range(book["serial_from"], book["serial_to"])
                   if book["serial_from"] else [])
        taken = sum(1 for sr in serials
                    if already_received(db, sr, book.get("coupon_kind")) is not None)
        book["returned"] = taken
        book["remaining"] = max((book["count"] or len(serials) or 0) - taken, 0)
    books.sort(key=lambda b: (b["invoice_date"] or "", b["invoice_id"]), reverse=True)
    return books


def delete_receipt(db: Session, *, receipt_id: int, actor_user_id: int) -> str:
    receipt = db.scalar(
        select(CouponReceipt).options(selectinload(CouponReceipt.lines))
        .where(CouponReceipt.id == receipt_id))
    if receipt is None:
        raise CouponReceiptError("الاستلام ده مش موجود.")

    serials = sorted(line.serial for line in receipt.lines)
    doc = receipt.document_number
    audit_service.record(
        db, action="coupon_receipt.delete", actor_user_id=actor_user_id,
        entity_type="coupon_receipt", entity_id=receipt.id,
        before={"doc": doc, "count": len(serials), "serials": serials,
                "customer_id": receipt.customer_id},
    )
    db.delete(receipt)
    db.flush()
    return doc
