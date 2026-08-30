"""تقارير التشغيل — النقاط والكوبونات والمعاينات والشيكات والطلبات والحجوزات.

سبع مواضيع مالهاش أي تقرير مجمّع في النظام دلوقتي. All seven have a listing screen and nothing
else: you can page through five thousand point records but not ask «مين أعلى عملاء في النقاط»، ولا
«المعاينات اتوزّعت إزاي على المندوبين»، ولا «الشيكات اللي بتستحق الأسبوع الجاي». That is the gap
this module closes, and it closes it the same way `trade_reports.py` and `hr_reports.py` do —
`subject × level × group_by` over one flattened row shape — because seven separate report modules
drift apart and one engine does not.

الشيكات هنا مختلفة عن الباقي في حاجة واحدة تستاهل تتقال: **المحفظة مش الحركة**. A cheque report
that lists what was registered this month answers a question nobody asks. The question is «إيه
اللي في المحفظة، وإيه اللي بيستحق قريب، وإيه اللي ارتد» — so the date filter runs on
`due_date`, not on when the cheque was written down, and `days_to_due` is on every row.

نفس القاعدتين بتوع `hr_reports`:

* **الترقيم في السيرفر والإجماليات على كل الصفوف المفلترة.** A total that describes the visible
  page looks like an answer and is the answer for the first five hundred rows only.
* **الحركة الملغاة مابتتحسبش في الإجمالي** — a voided coupon and a cancelled reservation are rows
  worth seeing and figures worth excluding, so they carry `counts=False` and drop out of the
  totals while staying on screen.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.money import ZERO, ZERO_QTY, to_money, to_qty
from src.models.cheque import Cheque, ChequeDirection, ChequeStatus
from src.models.coupon_receipt import CouponReceipt
from src.models.customer import Customer
from src.models.inspection import Inspection, VisitKind
from src.models.loyalty import Coupon, CouponType, PointRecord
from src.models.org import Branch
from src.models.reservation import Reservation
from src.models.supplier import Supplier
from src.models.trade_order import TradeOrder
from src.models.user import User

SUBJECTS = ("points", "coupons", "coupon_receipts", "inspections", "cheques",
            "orders", "reservations")
LEVELS = ("detail", "summary")
GROUPS = ("none", "customer", "supplier", "rep", "kind", "status", "month", "branch", "shop")

DEFAULT_LIMIT = 500
MAX_LIMIT = 5000


class OpsReportError(ValueError):
    """طلب تقرير مالوش معنى — بيترد ٤٢٢ مش ٥٠٠."""


# ------------------------------------------------------------------ أدوات


def _as_date(value) -> date | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return datetime.fromisoformat(str(value)[:19]).date()


def _lookups(db: Session) -> dict:
    return {
        "customers": {c.id: c.name for c in db.scalars(select(Customer)).all()},
        "suppliers": {s.id: s.name for s in db.scalars(select(Supplier)).all()},
        "users": {u.id: (u.full_name or u.username) for u in db.scalars(select(User)).all()},
        "branches": {b.id: b.name for b in db.scalars(select(Branch)).all()},
    }


def _row(*, when: date | None = None, document_number: str | None = None,
         party_id: int | None = None, party: str | None = None,
         rep_id: int | None = None, rep: str | None = None,
         kind: str = "", label: str = "", status: str = "",
         branch_id: int | None = None, branch: str | None = None,
         shop: str | None = None, quantity=ZERO_QTY, amount=ZERO,
         counts: bool = True, extra: dict | None = None) -> dict:
    """الشكل الموحّد اللي كل موضوع بيتسطّح ليه.

    `counts` هو الفرق بين «الصف ده موجود» و«الصف ده بيتحسب». A voided coupon belongs on the
    screen — somebody is looking for why it is gone — and does not belong in «إجمالي قيمة
    الكوبونات». Dropping it from the rows would answer the second question by hiding the first.
    """
    return {
        "date": str(when) if when else None,
        "period": str(when)[:7] if when else "",
        "document_number": document_number,
        "party_id": party_id, "party": party,
        "rep_id": rep_id, "rep": rep,
        "kind": kind, "label": label, "status": status,
        "branch_id": branch_id, "branch": branch,
        "shop": shop,
        "quantity": str(to_qty(Decimal(str(quantity or 0)))),
        "amount": str(to_money(Decimal(str(amount or 0)))),
        "counts": counts,
        **(extra or {}),
    }


def _within(when: date | None, date_from: date | None, date_to: date | None) -> bool:
    if when is None:
        return not (date_from or date_to)
    if date_from and when < date_from:
        return False
    return not (date_to and when > date_to)


# ------------------------------------------------------------------ المواضيع


def _point_label(kind: str) -> str:
    """اسم نوع الحركة بالعربي — من `points_service` عشان مايبقاش فيه نسختين.

    كانت هنا قايمة تانية ناقصة `inspection` و`inspection_reverse`، فأول ما الخصم
    يشتغل كانوا هيتعرضوا بالإنجليزي الخام في التقرير.
    """
    from src.services.points_service import KIND_LABELS

    return KIND_LABELS.get(kind, kind)


def _collect_points(db, look, filters) -> list[dict]:
    """حركة النقاط — الرصيد هو مجموع الحركة، مش عمود محفوظ في مكان تاني.

    الفلترة في `WHERE` مش في حلقة بايثون. كانت بتجيب الجدول كله وتفلتره في الذاكرة،
    وده عدّى من غير ما حد ياخد باله لأن الجدول كان صفر صف — أول ما اتعبّى بقى
    كل فتحة للشاشة بتقرا الدفتر كامل عشان تعرض شهر.
    """
    date_from, date_to = filters["date_from"], filters["date_to"]
    stmt = select(PointRecord)
    if date_from:
        stmt = stmt.where(PointRecord.created_at >= date_from)
    if date_to:
        # `created_at` وقت مش تاريخ — المقارنة بـ`<= date_to` بتقص يوم النهاية كله.
        stmt = stmt.where(PointRecord.created_at < date_to + timedelta(days=1))
    if filters.get("customer_id"):
        stmt = stmt.where(PointRecord.customer_id == filters["customer_id"])

    rows = []
    for record in db.scalars(stmt.order_by(PointRecord.created_at)).all():
        when = record.created_at.date() if record.created_at else None
        kind = record.kind.value
        rows.append(_row(
            when=when,
            party_id=record.customer_id, party=look["customers"].get(record.customer_id),
            rep_id=record.actor_user_id, rep=look["users"].get(record.actor_user_id),
            kind=kind, label=_point_label(kind), status=kind,
            # النقاط بتتحط في `quantity` مش `amount` — دي مش فلوس، والعمود بيقول كده.
            quantity=record.delta,
            extra={"delta": str(record.delta),
                   "sales_invoice_id": record.sales_invoice_id,
                   "coupon_id": record.coupon_id},
        ))
    return rows


_COUPON_STATUS = {"issued": "مصروف", "redeemed": "مستهلك", "voided": "ملغي"}


def _collect_coupons(db, look, filters) -> list[dict]:
    date_from, date_to = filters["date_from"], filters["date_to"]
    types = {t.id: t.name for t in db.scalars(select(CouponType)).all()}
    rows = []
    for coupon in db.scalars(select(Coupon).order_by(Coupon.created_at)).all():
        when = coupon.created_at.date() if coupon.created_at else None
        if not _within(when, date_from, date_to):
            continue
        if filters.get("customer_id") and coupon.customer_id != filters["customer_id"]:
            continue
        status = coupon.status.value
        rows.append(_row(
            when=when,
            party_id=coupon.customer_id, party=look["customers"].get(coupon.customer_id),
            kind=types.get(coupon.coupon_type_id, coupon.kind.value),
            label=_COUPON_STATUS.get(status, status), status=status,
            quantity=1, amount=coupon.value,
            # الملغي بيتعرض ومابيتحسبش — إجمالي بيعدّ كوبونات ملغاة بيقول إن الشركة مدينة بيها.
            counts=status != "voided",
            extra={"serial": coupon.serial,
                   "points_consumed": coupon.points_consumed},
        ))
    return rows


def _collect_coupon_receipts(db, look, filters) -> list[dict]:
    """استلام الكوبونات من التجّار — «مين سلّم كام، ومين لسه»."""
    date_from, date_to = filters["date_from"], filters["date_to"]
    rows = []
    for receipt in db.scalars(select(CouponReceipt).order_by(CouponReceipt.id)).all():
        # الاستلامات القديمة `received_date` فيها فاضي — بنرجع لتاريخ التسجيل بدل ما الصف يتشال
        # خالص. استلام مالوش تاريخ مسجّل لسه اتسجّل في يوم معروف.
        when = receipt.received_date or (
            receipt.created_at.date() if receipt.created_at else None)
        if not _within(when, date_from, date_to):
            continue
        if filters.get("customer_id") and receipt.customer_id != filters["customer_id"]:
            continue
        rows.append(_row(
            when=when, document_number=receipt.document_number,
            party_id=receipt.customer_id, party=look["customers"].get(receipt.customer_id),
            rep_id=receipt.rep_user_id, rep=look["users"].get(receipt.rep_user_id),
            kind=receipt.declared_kind or "عادي",
            label=receipt.declared_kind or "عادي",
            status=receipt.customer_type or "",
            quantity=receipt.coupon_count,
            amount=(Decimal(str(receipt.declared_value or 0))
                    * Decimal(str(receipt.coupon_count or 0))),
            extra={"declared_value": str(receipt.declared_value or 0),
                   "synced": receipt.client_uuid is not None,
                   "notes": receipt.notes},
        ))
    return rows


_VISIT_LABEL = {VisitKind.technician: "معاينة فني", VisitKind.regular: "زيارة عادية"}


def _collect_inspections(db, look, filters) -> list[dict]:
    """المعاينات — نقاط مش فلوس. أصناف المعاينة مابتخصمش من عهدة حد."""
    date_from, date_to = filters["date_from"], filters["date_to"]
    rows = []
    for visit in db.scalars(select(Inspection).order_by(Inspection.inspection_date)).all():
        when = visit.inspection_date
        if not _within(when, date_from, date_to):
            continue
        if filters.get("rep_id") and visit.rep_user_id != filters["rep_id"]:
            continue
        if filters.get("customer_id") and visit.customer_id != filters["customer_id"]:
            continue
        status = visit.status.value
        rows.append(_row(
            when=when, document_number=visit.document_number,
            party_id=visit.customer_id,
            party=look["customers"].get(visit.customer_id) or visit.owner_name,
            rep_id=visit.rep_user_id, rep=look["users"].get(visit.rep_user_id),
            kind=visit.inspection_type or _VISIT_LABEL.get(visit.visit_kind, ""),
            label=_VISIT_LABEL.get(visit.visit_kind, visit.visit_kind.value),
            status=status,
            shop=visit.purchase_shop,
            quantity=visit.total_points,
            # المرفوضة بديل الحذف — بتفضل بتتعرض ومابتتحسبش.
            counts=status != "rejected",
            extra={"visit_kind": visit.visit_kind.value,
                   "technician_name": visit.technician_name,
                   "owner_name": visit.owner_name,
                   "printed": visit.printed,
                   "items": len(visit.items or [])},
        ))
    return rows


_CHEQUE_STATUS = {"pending": "تحت التحصيل", "settled": "محصّل",
                  "bounced": "مرتد", "cancelled": "ملغي"}


def _collect_cheques(db, look, filters, *, today: date) -> list[dict]:
    """محفظة الشيكات — بتتفلتر بتاريخ **الاستحقاق** مش بتاريخ التسجيل.

    «الشيكات اللي بتستحق الشهر الجاي» is the question; a report filtered on when the cheque was
    written down answers a different one and looks identical.
    """
    date_from, date_to = filters["date_from"], filters["date_to"]
    rows = []
    for cheque in db.scalars(select(Cheque).order_by(Cheque.due_date)).all():
        if not _within(cheque.due_date, date_from, date_to):
            continue
        incoming = cheque.direction == ChequeDirection.incoming
        party_id = cheque.customer_id if incoming else cheque.supplier_id
        party = (look["customers"] if incoming else look["suppliers"]).get(party_id)
        status = cheque.status.value
        days = (cheque.due_date - today).days if cheque.due_date else None
        rows.append(_row(
            when=cheque.due_date, document_number=cheque.document_number,
            party_id=party_id, party=party,
            kind="وارد" if incoming else "صادر",
            label=_CHEQUE_STATUS.get(status, status), status=status,
            quantity=1, amount=cheque.amount,
            counts=status not in ("cancelled",),
            extra={"cheque_number": cheque.cheque_number,
                   "bank_name": cheque.bank_name,
                   "issue_date": str(cheque.issue_date) if cheque.issue_date else None,
                   "due_date": str(cheque.due_date) if cheque.due_date else None,
                   "settled_on": str(cheque.settled_on) if cheque.settled_on else None,
                   "direction": cheque.direction.value,
                   "days_to_due": days,
                   # المتأخر هو اللي فات استحقاقه وهو لسه تحت التحصيل — مش أي شيك قديم.
                   "overdue": bool(days is not None and days < 0
                                   and cheque.status == ChequeStatus.pending)},
        ))
    return rows


_ORDER_STATUS = {"open": "مفتوح", "converted": "اتحوّل لفاتورة", "cancelled": "ملغي"}


def _collect_orders(db, look, filters, *, today: date) -> list[dict]:
    date_from, date_to = filters["date_from"], filters["date_to"]
    rows = []
    for order in db.scalars(select(TradeOrder).order_by(TradeOrder.order_date)).all():
        if not _within(order.order_date, date_from, date_to):
            continue
        sale = order.kind.value == "sale"
        party_id = order.customer_id if sale else order.supplier_id
        party = (look["customers"] if sale else look["suppliers"]).get(party_id)
        status = order.status.value
        late = bool(order.due_date and order.due_date < today and status == "open")
        rows.append(_row(
            when=order.order_date, document_number=order.document_number,
            party_id=party_id, party=party,
            branch_id=order.branch_id, branch=look["branches"].get(order.branch_id),
            kind="طلب بيع" if sale else "طلب شراء",
            label=_ORDER_STATUS.get(status, status), status=status,
            quantity=len(order.lines or []), amount=order.total,
            counts=status != "cancelled",
            extra={"order_kind": order.kind.value,
                   "due_date": str(order.due_date) if order.due_date else None,
                   "converted_invoice_id": order.converted_invoice_id,
                   # «فات ميعاده ولسه مفتوح» هو السبب الوحيد اللي حد بيفتح التقرير ده عشانه.
                   "late": late},
        ))
    return rows


_RESERVATION_STATUS = {"active": "سارٍ", "converted": "اتحوّل لفاتورة", "cancelled": "ملغي"}


def _collect_reservations(db, look, filters, *, today: date) -> list[dict]:
    date_from, date_to = filters["date_from"], filters["date_to"]
    rows = []
    for hold in db.scalars(select(Reservation).order_by(Reservation.expires_on)).all():
        if not _within(hold.expires_on, date_from, date_to):
            continue
        if filters.get("customer_id") and hold.customer_id != filters["customer_id"]:
            continue
        status = hold.status.value
        rows.append(_row(
            when=hold.expires_on, document_number=hold.document_number,
            party_id=hold.customer_id, party=look["customers"].get(hold.customer_id),
            kind=hold.location_kind.value,
            label=_RESERVATION_STATUS.get(status, status), status=status,
            quantity=hold.quantity,
            counts=status == "active",
            extra={"item_id": hold.item_id,
                   "expires_on": str(hold.expires_on),
                   # حجز سارٍ فات ميعاده لسه ماسك بضاعة محدش بيسأل عنها.
                   "expired": bool(hold.expires_on and hold.expires_on < today
                                   and status == "active")},
        ))
    return rows


# ------------------------------------------------------------------ التجميع


_GROUP_KEY = {
    "customer": ("party_id", "party"),
    "supplier": ("party_id", "party"),
    "rep": ("rep_id", "rep"),
    "kind": ("kind", "kind"),
    "status": ("label", "label"),
    "month": ("period", "period"),
    "branch": ("branch_id", "branch"),
    "shop": ("shop", "shop"),
}


def _group(rows: list[dict], group_by: str) -> list[dict]:
    key_field, label_field = _GROUP_KEY[group_by]
    buckets: dict = {}
    for row in rows:
        key = row.get(key_field)
        bucket = buckets.setdefault(key, {
            "key": key, "label": row.get(label_field) or "— بدون —",
            "rows": 0, "counted": 0, "quantity": ZERO_QTY, "amount": ZERO,
        })
        bucket["rows"] += 1
        if not row.get("counts", True):
            continue
        bucket["counted"] += 1
        bucket["quantity"] += Decimal(row["quantity"])
        bucket["amount"] += Decimal(row["amount"])
    out = [{
        "key": b["key"], "label": b["label"], "rows": b["rows"], "counted": b["counted"],
        "quantity": str(to_qty(b["quantity"])), "amount": str(to_money(b["amount"])),
    } for b in buckets.values()]
    out.sort(key=lambda r: (Decimal(r["amount"]), Decimal(r["quantity"])), reverse=True)
    return out


def _totals(rows: list[dict]) -> dict:
    """على كل الصفوف المفلترة، مش على الصفحة — و«الملغي» بيتعدّ ومابيتجمّعش."""
    counted = [r for r in rows if r.get("counts", True)]
    return {
        "rows": len(rows),
        "counted": len(counted),
        "excluded": len(rows) - len(counted),
        "quantity": str(to_qty(sum((Decimal(r["quantity"]) for r in counted), ZERO_QTY))),
        "amount": str(to_money(sum((Decimal(r["amount"]) for r in counted), ZERO))),
    }


# ------------------------------------------------------------------ المحرك


def ops(
    db: Session,
    *,
    subject: str = "inspections",
    level: str = "detail",
    group_by: str = "none",
    date_from=None,
    date_to=None,
    customer_id: int | None = None,
    rep_id: int | None = None,
    status: str | None = None,
    kind: str | None = None,
    due_within_days: int | None = None,
    only_open: bool = False,
    limit: int | None = None,
    offset: int = 0,
    today: date | None = None,
) -> dict:
    """`subject` × `level` × `group_by` — تقارير التشغيل كلها من دالة واحدة."""
    if subject not in SUBJECTS:
        raise OpsReportError(f"موضوع مش معروف: {subject}")
    if level not in LEVELS:
        raise OpsReportError(f"مستوى مش معروف: {level}")
    if group_by not in GROUPS:
        raise OpsReportError(f"تجميع مش معروف: {group_by}")
    if level == "summary" and group_by == "none":
        raise OpsReportError("الملخّص محتاج تجميع.")

    today = today or date.today()
    look = _lookups(db)
    filters = {
        "date_from": _as_date(date_from), "date_to": _as_date(date_to),
        "customer_id": customer_id, "rep_id": rep_id,
    }
    # «بيستحق خلال ٣٠ يوم» بيتحوّل لمدى تواريخ عادي بدل ما يبقى فرع تاني في كل موضوع.
    if due_within_days is not None:
        filters["date_from"] = filters["date_from"] or today
        filters["date_to"] = today + timedelta(days=int(due_within_days))

    if subject == "points":
        rows = _collect_points(db, look, filters)
    elif subject == "coupons":
        rows = _collect_coupons(db, look, filters)
    elif subject == "coupon_receipts":
        rows = _collect_coupon_receipts(db, look, filters)
    elif subject == "inspections":
        rows = _collect_inspections(db, look, filters)
    elif subject == "cheques":
        rows = _collect_cheques(db, look, filters, today=today)
    elif subject == "orders":
        rows = _collect_orders(db, look, filters, today=today)
    else:
        rows = _collect_reservations(db, look, filters, today=today)

    if status:
        rows = [r for r in rows if r["status"] == status]
    if kind:
        rows = [r for r in rows if r["kind"] == kind]
    if only_open:
        # «المفتوح» معناه مختلف في كل موضوع، وكله بيرجع لنفس الحاجة: اللي لسه بيستنى تصرّف.
        rows = [r for r in rows if r["status"] in ("pending", "open", "active", "issued")]

    totals = _totals(rows)

    if level == "summary" or group_by != "none":
        grouped = _group(rows, group_by)
        return {"subject": subject, "level": level, "group_by": group_by,
                "rows": grouped, "totals": totals,
                "page": {"limit": None, "offset": 0, "total_rows": len(grouped),
                         "truncated": False}}

    size = min(int(limit or DEFAULT_LIMIT), MAX_LIMIT) if limit != 0 else len(rows)
    start = max(0, int(offset or 0))
    page = rows[start:start + size] if size else rows[start:]
    return {
        "subject": subject, "level": level, "group_by": group_by,
        "rows": page, "totals": totals,
        "page": {"limit": size or None, "offset": start, "total_rows": len(rows),
                 "truncated": start + len(page) < len(rows)},
    }


def top_customers(db: Session, *, metric: str = "points", limit: int = 20,
                  date_from=None, date_to=None) -> dict:
    """أعلى العملاء — بالنقاط أو بالكوبونات.

    Its own function rather than another `group_by`, because «أعلى ٢٠» is a ranking and a ranking
    is a different thing from a grouping: it is sorted, it is cut, and the cut is the point. A
    grouped report that happens to be sorted invites reading the twenty-first row as absent
    rather than as below the line.
    """
    if metric not in ("points", "coupons"):
        raise OpsReportError(f"مقياس مش معروف: {metric}")
    subject = "points" if metric == "points" else "coupons"
    report = ops(db, subject=subject, level="summary", group_by="customer",
                 date_from=date_from, date_to=date_to)
    rows = report["rows"][:max(1, int(limit))]
    return {"subject": subject, "metric": metric, "level": "summary",
            "group_by": "customer", "rows": rows, "totals": report["totals"],
            "page": {"limit": limit, "offset": 0,
                     "total_rows": len(report["rows"]),
                     "truncated": len(report["rows"]) > len(rows)}}
