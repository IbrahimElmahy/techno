"""استلام الكوبونات من العملاء — tracing a serial back to the sale that issued it.

The whole feature rests on one lookup: given a number written on a piece of paper, which invoice
issued it? The sales invoice stores the range it handed over, so the answer is a containment
check — and a serial that lands in no range was never issued by this system, which is exactly the
fraud the check exists to catch.

Two deliberate limits, both about not inventing certainty:

* Containment is arithmetic, so it only applies when the range and the serial are plain numbers.
  A lettered book (`A-100` … `A-140`) is matched only on its exact endpoints; guessing at the
  ordering of a format we do not control would accept coupons that were never printed.
* A serial is receivable once. The unique constraint on the line is what enforces it, so two
  branches receiving the same coupon at the same moment cannot both win.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from src.auth.branch_scope import branch_for
from src.models.coupon_receipt import CouponReceipt, CouponReceiptLine
from src.models.sales import SalesInvoice, SalesInvoiceCoupon
from src.services import audit_service, numbering


class CouponReceiptError(Exception):
    """The coupons cannot be received as presented."""


def _as_int(value) -> int | None:
    try:
        text = str(value).strip()
        return int(text) if text and str(int(text)) == text else None
    except (TypeError, ValueError):
        return None


def find_issuing_invoice(db: Session, serial: str,
                         coupon_kind: str | None = None) -> SalesInvoice | None:
    """The invoice whose issued range covers this serial, or None if nothing issued it.

    Two places to look. The invoice's own `coupon_serial_from/to` is where a single book was
    recorded before 0049; `sales_invoice_coupon` is the row-per-kind table that replaced it. Both
    are live — every invoice written before that migration has only the first — so a check that
    reads one of them calls half the real coupons unknown.

    **والفئة جزء من هوية الرقم.** دفتر الذهبي مرقّم ١..٥٠ ودفتر الفضي مرقّم ١..٥٠، فرقم «٥»
    لوحده مش بيحدد كوبون. من غير الفئة البحث بيرجّع أول فاتورة فيها الرقم ده مهما كانت
    فئتها — يعني كوبون فضي بيتحسب على فاتورة صرفت ذهبي. الحقل الأقدم على الفاتورة نفسها
    (`coupon_serial_from/to`) مالوش فئة، فبيتشاف بس لما ماتتحددش فئة.
    """
    serial = str(serial).strip()
    if not serial:
        return None

    # النطاق القديم على الفاتورة نفسها مالوش نوع، فمابيتشافش لما النوع متحدد.
    if coupon_kind is None:
        exact = db.scalar(
            select(SalesInvoice).where(
                (SalesInvoice.coupon_serial_from == serial)
                | (SalesInvoice.coupon_serial_to == serial)
            )
        )
        if exact is not None:
            return exact

    # The per-kind rows, exact endpoints first for the same reason.
    kind_rows = select(SalesInvoiceCoupon).where(
        (SalesInvoiceCoupon.serial_from == serial)
        | (SalesInvoiceCoupon.serial_to == serial)
    )
    if coupon_kind:
        kind_rows = kind_rows.where(SalesInvoiceCoupon.coupon_kind == coupon_kind)
    exact_row = db.scalar(kind_rows)
    if exact_row is not None:
        return db.get(SalesInvoice, exact_row.invoice_id)

    number = _as_int(serial)
    if number is None:
        return None

    # Numeric containment. The ranges are short and few per customer, so this is checked in
    # Python rather than as a cast in SQL — the column is a string precisely because not every
    # book is numeric, and casting the lettered ones would raise on some engines.
    if coupon_kind is None:
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

    ranged = select(SalesInvoiceCoupon).where(SalesInvoiceCoupon.serial_from.isnot(None))
    if coupon_kind:
        ranged = ranged.where(SalesInvoiceCoupon.coupon_kind == coupon_kind)
    for row in db.scalars(ranged).all():
        first = _as_int(row.serial_from)
        last = _as_int(row.serial_to)
        if first is None or last is None:
            continue
        if first <= number <= last:
            return db.get(SalesInvoice, row.invoice_id)
    return None


def already_received(db: Session, serial: str,
                     coupon_kind: str | None = None) -> CouponReceiptLine | None:
    """الكوبون ده رجع قبل كده؟ الرقم لوحده مش سؤال كامل — لازم معاه النوع."""
    stmt = select(CouponReceiptLine).where(CouponReceiptLine.serial == str(serial).strip())
    if coupon_kind:
        # السطور القديمة مالهاش فئة؛ بتتحسب على أي فئة لأن وقتها كان الترقيم واحد.
        stmt = stmt.where(
            (CouponReceiptLine.coupon_kind == coupon_kind)
            | (CouponReceiptLine.coupon_kind.is_(None))
        )
    return db.scalar(stmt)


def kinds_for_serial(db: Session, serial: str) -> list[str]:
    """كل فئة صُرف تحتها الرقم ده. أكتر من واحدة = الرقم لوحده مش بيحدد كوبون."""
    found: set[str] = set()
    number = _as_int(str(serial).strip())
    for row in db.scalars(select(SalesInvoiceCoupon)).all():
        if not row.coupon_kind:
            continue
        if str(serial).strip() in (row.serial_from, row.serial_to):
            found.add(row.coupon_kind)
            continue
        first, last = _as_int(row.serial_from), _as_int(row.serial_to)
        if first is None or last is None or number is None:
            continue
        if first <= number <= last:
            found.add(row.coupon_kind)
    return sorted(found)


def check_serial(db: Session, serial: str, coupon_kind: str | None = None) -> dict:
    """What the app calls per coupon: is this real, whose was it, and has it come back already?

    وبيرجّع **فئة الورقة** كمان. الفئة مش حاجة اللي بيستلم بيختارها — هي مكتوبة على الورقة
    وبتتحدد من الدفتر اللي اتصرف منه. الشاشة بتعرضها، ولو الرقم اتصرف تحت فئتين بيتقال
    إنه ملتبس بدل ما نختار واحدة ونحطّ الكوبون على فاتورة مش بتاعته.
    """
    serial = str(serial).strip()
    invoice = find_issuing_invoice(db, serial, coupon_kind)
    taken = already_received(db, serial, coupon_kind)
    status = "unknown" if invoice is None else ("received" if taken else "valid")
    customer_name = None
    if invoice is not None:
        from src.models.customer import Customer

        customer = db.get(Customer, invoice.customer_id)
        customer_name = customer.name if customer else None
    kinds = kinds_for_serial(db, serial)
    resolved = coupon_kind or (kinds[0] if len(kinds) == 1 else None)
    if len(kinds) > 1 and coupon_kind is None:
        status = "ambiguous"
    return {
        "serial": serial,
        "status": status,
        "coupon_kind": resolved,
        "kinds": kinds,
        "sales_invoice_id": invoice.id if invoice else None,
        "document_number": invoice.document_number if invoice else None,
        "customer_id": invoice.customer_id if invoice else None,
        "customer_name": customer_name,
        "received_receipt_id": taken.receipt_id if taken else None,
    }


def expand_range(serial_from: str, serial_to: str | None) -> list[str]:
    """Turn «from 1200 to 1249» into the serials it covers — numeric books only."""
    if not serial_to or str(serial_to).strip() == str(serial_from).strip():
        return [str(serial_from).strip()]
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


def create_receipt(
    db: Session, *, serials: list[str], actor_user_id: int,
    customer_id: int | None = None, rep_user_id: int | None = None,
    received_date: date | None = None, notes: str | None = None,
    declared_kind: str | None = None, declared_value: object | None = None,
    customer_type: str | None = None,
    client_uuid: str | None = None,
    coupon_kind: str | None = None,
) -> CouponReceipt:
    """Take in a handful of coupons, or refuse the lot.

    Every serial is checked before anything is written. One bad coupon fails the whole receipt
    rather than posting the good ones — a half-accepted handover is worse than a rejected one,
    because the rep walks away believing all of it went through.

    `coupon_kind` هي فئة الدفتر اللي الأرقام دي منه — عادي/فضي/ذهبي/ماسي. من غيرها الرقم
    لوحده مش بيحدد كوبون: الذهبي والفضي كل واحد مرقّم ١..٥٠، فكوبون فضي كان ممكن يتحسب
    على فاتورة صرفت ذهبي. بتتساب فاضية بس لو الشغل بدفتر واحد.
    """
    if client_uuid:
        existing = db.scalar(
            select(CouponReceipt).options(selectinload(CouponReceipt.lines))
            .where(CouponReceipt.client_uuid == client_uuid))
        if existing is not None:
            # The app retried a queued receipt after a dropped connection. Same document.
            return existing

    cleaned = [str(s).strip() for s in serials if str(s).strip()]
    if not cleaned:
        raise CouponReceiptError("مافيش كوبونات في الاستلام.")
    duplicates = {s for s in cleaned if cleaned.count(s) > 1}
    if duplicates:
        raise CouponReceiptError(f"كوبونات مكرّرة في نفس الاستلام: {', '.join(sorted(duplicates))}")

    matched: list[tuple[str, SalesInvoice]] = []
    unknown: list[str] = []
    seen_before: list[str] = []
    wrong_customer: list[str] = []
    for serial in cleaned:
        invoice = find_issuing_invoice(db, serial, coupon_kind)
        if invoice is None:
            unknown.append(serial)
            continue
        if already_received(db, serial, coupon_kind) is not None:
            seen_before.append(serial)
            continue
        if customer_id is not None and invoice.customer_id != customer_id:
            wrong_customer.append(serial)
            continue
        matched.append((serial, invoice))

    if unknown:
        raise CouponReceiptError(
            f"كوبونات مش متصرّفة من النظام: {', '.join(unknown)}")
    if seen_before:
        raise CouponReceiptError(
            f"كوبونات اتستلمت قبل كده: {', '.join(seen_before)}")
    if wrong_customer:
        raise CouponReceiptError(
            f"كوبونات متصرّفة لعميل تاني: {', '.join(wrong_customer)}")

    receipt = CouponReceipt(
        document_number=_doc_number(db), customer_id=customer_id, rep_user_id=rep_user_id,
        received_date=received_date, coupon_count=len(matched), notes=notes,
        declared_kind=declared_kind, declared_value=declared_value,
        customer_type=customer_type,
        client_uuid=client_uuid, actor_user_id=actor_user_id,
        # العهدة بتقول فرع المندوب اللي استلم؛ ومن غير مندوب بيرجع لفرع اللي سجّل.
        branch_id=branch_for(db, actor_user_id=actor_user_id,
                             location_kind="rep", location_id=rep_user_id),
    )
    db.add(receipt)
    db.flush()
    for serial, invoice in matched:
        db.add(CouponReceiptLine(
            receipt_id=receipt.id, serial=serial, sales_invoice_id=invoice.id,
            coupon_kind=coupon_kind))
    db.flush()

    audit_service.record(
        db, action="coupon_receipt.create", actor_user_id=actor_user_id,
        entity_type="coupon_receipt", entity_id=receipt.id,
        after={"doc": receipt.document_number, "count": len(matched)},
    )
    return receipt


def list_receipts(
    db: Session, *, customer_id: int | None = None, rep_user_id: int | None = None,
) -> list[CouponReceipt]:
    stmt = select(CouponReceipt).options(selectinload(CouponReceipt.lines))
    if customer_id:
        stmt = stmt.where(CouponReceipt.customer_id == customer_id)
    if rep_user_id:
        stmt = stmt.where(CouponReceipt.rep_user_id == rep_user_id)
    return list(db.scalars(stmt.order_by(CouponReceipt.id.desc())).all())


def get_receipt(db: Session, receipt_id: int) -> CouponReceipt:
    receipt = db.scalar(
        select(CouponReceipt).options(selectinload(CouponReceipt.lines))
        .where(CouponReceipt.id == receipt_id))
    if receipt is None:
        raise CouponReceiptError("الاستلام غير موجود.")
    return receipt


def issued_to_customer(db: Session, customer_id: int) -> list[dict]:
    """Every coupon book this customer was handed, and how much of it has come back.

    This is what a return screen needs before it will accept a coupon: a customer can only bring
    back what he was given. Offering a free serial box and validating afterwards means the counter
    finds out at the end of a document that half of it cannot be saved — and the customer is
    standing there.

    Reads both shapes: the invoice's own single range (pre-0049) and the row-per-kind table that
    replaced it. An invoice that carries both is counted once from the per-kind rows, which are the
    more precise record.
    """
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
        # Only the invoices with no per-kind rows fall back to the old single range, so a book is
        # never listed twice.
        if inv.id in with_rows or not inv.coupon_count:
            continue
        books.append({
            "invoice_id": inv.id, "document_number": inv.document_number,
            "invoice_date": str(inv.invoice_date) if inv.invoice_date else None,
            "coupon_kind": None,
            "count": inv.coupon_count,
            "serial_from": inv.coupon_serial_from, "serial_to": inv.coupon_serial_to,
        })

    # How many of each book have already been handed back, so the screen offers the remainder
    # rather than the original count.
    for book in books:
        serials = (expand_range(book["serial_from"], book["serial_to"])
                   if book["serial_from"] else [])
        taken = sum(1 for sr in serials
                    if already_received(db, sr, book.get("coupon_kind")) is not None)
        book["returned"] = taken
        book["remaining"] = max((book["count"] or len(serials) or 0) - taken, 0)
    books.sort(key=lambda b: (b["invoice_date"] or "", b["invoice_id"]), reverse=True)
    return books
