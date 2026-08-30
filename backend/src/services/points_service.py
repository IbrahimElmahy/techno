"""دفتر نقاط التجار — القراءة والكتابة في مكان واحد.

**الرصيد مشتق، مش مخزّن.** مافيش عمود `points_balance` على العميل ولا هيبقى فيه: الرصيد
هو `SUM(delta)` على دفتره وخلاص. مصدرين للحقيقة معناه إن أول سطر يتكتب من غير ما العمود
يتحدّث، الاتنين يفضلوا يقولوا كلامين مختلفين ومحدش يعرف مين الصح.

`post()` هو الطريق الوحيد للكتابة هنا. الدفتر append-only: التصحيح سطر جديد مربوط
بالأصلي، مش تعديل ولا مسح.

ملحوظة: `point_service.py` (بالمفرد) بيمسك كسب البيع والتحويل لكوبونات من أيام 003.
الملف ده هو طبقة القراءة (رصيد/دفتر/إجماليات) وكتابة نقط المعاينات. الاتنين بيكتبوا في
نفس الجدول بنفس الشكل.
"""
from __future__ import annotations

import logging
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from src.models.loyalty import Coupon, PointKind, PointRecord

log = logging.getLogger("uvicorn.error")

ZERO = Decimal("0.000")

# أسماء الحركات بالعربي — الشاشتين (تبويب العميل وسجل النقاط) بيقروا من هنا، فالاسم
# بيتغيّر في مكان واحد.
KIND_LABELS: dict[str, str] = {
    "earn": "كسب من فاتورة",
    "reverse": "خصم مرتجع",
    "converted": "تحويل لكوبونات",
    "void_reclaim": "استرجاع كوبون ملغي",
    "adjustment": "تسوية يدوية",
    "inspection": "خصم معاينة",
    "inspection_reverse": "رجوع معاينة مرفوضة",
}


def _points(value) -> Decimal:
    """النقط كسور (١/٦ نقطة مثلاً) — التقريب على ٣ خانات زي عمود القاعدة."""
    return Decimal(str(value if value is not None else 0)).quantize(Decimal("0.001"))


# --- القراءة ---

def balance(db: Session, customer_id: int) -> Decimal:
    """رصيد العميل = مجموع دفتره. ممكن يطلع سالب (نقط مستهلكة أكتر من المكسوبة)."""
    total = db.scalar(
        select(func.coalesce(func.sum(PointRecord.delta), 0))
        .where(PointRecord.customer_id == customer_id)
    )
    return _points(total)


def balances(db: Session, customer_ids: list[int] | None = None) -> dict[int, Decimal]:
    """أرصدة مجموعة عملاء في استعلام واحد.

    موجودة عشان الكشوف: `balance()` جوّه حلقة على ٢٨١ عميل = ٢٨١ رحلة للقاعدة. العميل
    اللي مالوش ولا سطر مابيرجعش في النتيجة — القارئ بيستخدم `.get(id, ZERO)`.
    """
    stmt = select(PointRecord.customer_id, func.coalesce(func.sum(PointRecord.delta), 0))
    if customer_ids:
        stmt = stmt.where(PointRecord.customer_id.in_(customer_ids))
    stmt = stmt.group_by(PointRecord.customer_id)
    return {cid: _points(total) for cid, total in db.execute(stmt).all()}


def _doc_numbers(db: Session, records: list[PointRecord]) -> dict[tuple[str, int], str]:
    """أرقام المستندات المربوطة، مجمّعة — أربع استعلامات مهما كان عدد السطور.

    مجمّعة عن قصد ومتنادية مرة واحدة برّه حلقة الصفوف: استعلام لكل سطر × ٢٨٧٩٠ سطر =
    كشف مابيفتحش.
    """
    from src.models.inspection import Inspection
    from src.models.sales import SalesInvoice, SalesReturn

    out: dict[tuple[str, int], str] = {}
    plans = [
        ("invoice", "sales_invoice_id", SalesInvoice, SalesInvoice.document_number),
        ("return", "sales_return_id", SalesReturn, SalesReturn.document_number),
        ("inspection", "inspection_id", Inspection, Inspection.document_number),
        ("coupon", "coupon_id", Coupon, Coupon.serial),
    ]
    for tag, attr, model, label_col in plans:
        ids = {getattr(r, attr) for r in records if getattr(r, attr, None) is not None}
        if not ids:
            continue
        for row_id, label in db.execute(
            select(model.id, label_col).where(model.id.in_(ids))
        ).all():
            out[(tag, row_id)] = label
    return out


def _doc_ref(record: PointRecord) -> tuple[str | None, int | None]:
    """المستند اللي السطر جاي منه — نوعه ورقمه الداخلي."""
    if record.sales_invoice_id is not None:
        return "invoice", record.sales_invoice_id
    if record.sales_return_id is not None:
        return "return", record.sales_return_id
    if getattr(record, "inspection_id", None) is not None:
        return "inspection", record.inspection_id
    if record.coupon_id is not None:
        return "coupon", record.coupon_id
    return None, None


def _filtered(stmt, *, customer_id, kinds, date_from, date_to):
    if customer_id is not None:
        stmt = stmt.where(PointRecord.customer_id == customer_id)
    if kinds:
        stmt = stmt.where(PointRecord.kind.in_(list(kinds)))
    if date_from is not None:
        stmt = stmt.where(
            PointRecord.created_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to is not None:
        stmt = stmt.where(
            PointRecord.created_at <= datetime.combine(date_to, datetime.max.time()))
    return stmt


def ledger(
    db: Session,
    *,
    customer_id: int | None = None,
    kinds: list[str] | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = 500,
    offset: int = 0,
) -> dict:
    """حركة الدفتر + الإجماليات.

    الرصيد الجاري بيتحسب لعميل واحد بس — «رصيد جاري» على كشف فيه عملاء مخلوطين رقم
    مالوش معنى. ولما فيه فلتر تاريخ بيبدأ من رصيد ما قبل الفترة (opening) مش من صفر،
    وإلا آخر سطر في الكشف يقول رقم غير رصيد العميل الحقيقي.

    الإجماليات بتتحسب في القاعدة على الحركة كلها — مش على الصفحة المعروضة. إجمالي
    بيتجمع من ٥٠٠ سطر معروضين بيقول رقم غلط وهو واثق.
    """
    kinds = [k for k in (kinds or []) if k in KIND_LABELS] or None

    positive = case((PointRecord.delta > 0, PointRecord.delta), else_=0)
    negative = case((PointRecord.delta < 0, PointRecord.delta), else_=0)
    totals_row = db.execute(_filtered(
        select(
            func.count(PointRecord.id),
            func.coalesce(func.sum(positive), 0),
            func.coalesce(func.sum(negative), 0),
        ),
        customer_id=customer_id, kinds=kinds, date_from=date_from, date_to=date_to,
    )).one()
    count, earned, spent = int(totals_row[0]), _points(totals_row[1]), _points(totals_row[2])

    opening = ZERO
    if customer_id is not None and date_from is not None:
        opening = _points(db.scalar(
            select(func.coalesce(func.sum(PointRecord.delta), 0)).where(
                PointRecord.customer_id == customer_id,
                PointRecord.created_at < datetime.combine(date_from, datetime.min.time()),
            )
        ))
    if customer_id is not None and offset:
        # الصفحة التانية بتبدأ من رصيد آخر سطر في الأولى، مش من الصفر. من غير ده كل صفحة
        # بتقول رصيد جاري بيبدأ من أول الدنيا، وآخر سطر في آخر صفحة بيخالف رصيد العميل.
        skipped = db.scalars(_filtered(
            select(PointRecord.delta), customer_id=customer_id, kinds=kinds,
            date_from=date_from, date_to=date_to,
        ).order_by(PointRecord.created_at, PointRecord.id).limit(offset)).all()
        opening = _points(opening + sum((_points(d) for d in skipped), ZERO))

    stmt = _filtered(select(PointRecord), customer_id=customer_id, kinds=kinds,
                     date_from=date_from, date_to=date_to)
    # تصاعدي للعميل الواحد عشان الرصيد الجاري يتقرا من فوق لتحت؛ وتنازلي للكشف العام
    # عشان أحدث حركة تبان الأول.
    if customer_id is not None:
        stmt = stmt.order_by(PointRecord.created_at, PointRecord.id)
    else:
        stmt = stmt.order_by(PointRecord.created_at.desc(), PointRecord.id.desc())
    records = list(db.scalars(stmt.limit(limit).offset(offset)).all())

    docs = _doc_numbers(db, records)
    names: dict[int, str] = {}
    if customer_id is None and records:
        from src.models.customer import Customer

        ids = {r.customer_id for r in records}
        names = dict(db.execute(
            select(Customer.id, Customer.name).where(Customer.id.in_(ids))).all())

    running = opening
    rows = []
    for r in records:
        delta = _points(r.delta)
        kind = r.kind.value if hasattr(r.kind, "value") else str(r.kind)
        doc_kind, doc_id = _doc_ref(r)
        row = {
            "id": r.id,
            "customer_id": r.customer_id,
            "customer_name": names.get(r.customer_id),
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "date": r.created_at.date().isoformat() if r.created_at else None,
            "kind": kind,
            "kind_label": KIND_LABELS.get(kind, kind),
            "delta": str(delta),
            "earned": str(delta if delta > 0 else ZERO),
            "spent": str(-delta if delta < 0 else ZERO),
            "doc_kind": doc_kind,
            "doc_id": doc_id,
            "doc_number": docs.get((doc_kind, doc_id)) if doc_kind else None,
            "running": None,
        }
        if customer_id is not None:
            running += delta
            row["running"] = str(_points(running))
        rows.append(row)

    return {
        "rows": rows,
        "count": count,
        "opening": str(opening),
        "earned": str(earned),
        "spent": str(-spent),          # المنصرف بيتعرض موجب
        "net": str(_points(earned + spent)),
        "balance": str(balance(db, customer_id)) if customer_id is not None else None,
    }


# --- الكتابة ---

def post(
    db: Session,
    *,
    customer_id: int,
    kind: PointKind,
    delta,
    sales_invoice_id: int | None = None,
    sales_return_id: int | None = None,
    inspection_id: int | None = None,
    coupon_id: int | None = None,
    conversion_id: int | None = None,
    origin_earn_id: int | None = None,
    actor_user_id: int | None = None,
    created_at: datetime | None = None,
    flush: bool = True,
) -> PointRecord:
    """السطر الوحيد اللي بيكتب في الدفتر.

    `created_at` بيتمرّر صراحةً في الترحيل الرجعي: نقط فاتورة ٢٠٢٣ لازم تقع في ٢٠٢٣،
    مش في يوم تشغيل السكربت — وإلا أي كشف بفترة بيقول إن الشركة وزّعت نص مليون نقطة
    في يوم واحد.

    `flush=False` للترحيل الجَملي بس: flush لكل سطر معناه ٢٨٧٩٠ رحلة للقاعدة على الشبكة.
    اللي بيستعملها لازم يعمل flush بنفسه على دفعات، وماياخدش `record.id` قبلها.
    """
    record = PointRecord(
        customer_id=customer_id,
        kind=kind,
        delta=_points(delta),
        sales_invoice_id=sales_invoice_id,
        sales_return_id=sales_return_id,
        inspection_id=inspection_id,
        coupon_id=coupon_id,
        conversion_id=conversion_id,
        origin_earn_id=origin_earn_id,
        actor_user_id=actor_user_id,
    )
    if created_at is not None:
        record.created_at = created_at
    db.add(record)
    if flush:
        db.flush()
    return record
