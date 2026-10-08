from __future__ import annotations

import logging
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from sqlalchemy import and_, or_

from src.models.loyalty import (
    PURSE_BY_KIND,
    Coupon,
    PointKind,
    PointPurse,
    PointRecord,
)

log = logging.getLogger("uvicorn.error")

ZERO = Decimal("0.000")

KIND_LABELS: dict[str, str] = {
    "earn": "كسب من فاتورة",
    "reverse": "خصم مرتجع",
    "converted": "تحويل لكوبونات",
    "void_reclaim": "استرجاع كوبون ملغي",
    "adjustment": "تسوية يدوية",
    "inspection": "خصم معاينة",
    "inspection_reverse": "رجوع معاينة مرفوضة",
}


PURSE_LABELS: dict[str, str] = {
    "both": "الجيبين",
    "inspection": "معاينات",
    "coupon": "كوبونات",
}


def _points(value) -> Decimal:
    return Decimal(str(value if value is not None else 0)).quantize(Decimal("0.001"))


def purse_filter(purse: PointPurse):
    wanted = (PointPurse.both, purse)
    legacy_kinds = [k for k, p in PURSE_BY_KIND.items() if p in wanted]
    return or_(
        PointRecord.purse.in_([p.value for p in wanted]),
        and_(PointRecord.purse.is_(None), PointRecord.kind.in_(legacy_kinds)),
    )


def balance(db: Session, customer_id: int, purse: PointPurse | None = None) -> Decimal:
    stmt = select(func.coalesce(func.sum(PointRecord.delta), 0)).where(
        PointRecord.customer_id == customer_id)
    if purse is not None:
        stmt = stmt.where(purse_filter(purse))
    return _points(db.scalar(stmt))


def purse_balances(db: Session, customer_id: int) -> dict[str, Decimal]:
    return {
        "inspection": balance(db, customer_id, PointPurse.inspection),
        "coupon": balance(db, customer_id, PointPurse.coupon),
    }


def balances(db: Session, customer_ids: list[int] | None = None,
             purse: PointPurse | None = None) -> dict[int, Decimal]:
    stmt = select(PointRecord.customer_id, func.coalesce(func.sum(PointRecord.delta), 0))
    if customer_ids:
        stmt = stmt.where(PointRecord.customer_id.in_(customer_ids))
    if purse is not None:
        stmt = stmt.where(purse_filter(purse))
    stmt = stmt.group_by(PointRecord.customer_id)
    return {cid: _points(total) for cid, total in db.execute(stmt).all()}


def _doc_numbers(db: Session, records: list[PointRecord]) -> dict[tuple[str, int], str]:
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
    asked = list(kinds or [])
    kinds = [k for k in asked if k in KIND_LABELS]
    if asked and not kinds:
        kinds = ["__no_such_kind__"]
    kinds = kinds or None

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
    stmt = _filtered(select(PointRecord), customer_id=customer_id, kinds=kinds,
                     date_from=date_from, date_to=date_to)
    stmt = stmt.order_by(PointRecord.created_at.desc(), PointRecord.id.desc())
    records = list(db.scalars(stmt.limit(limit).offset(offset)).all())

    running = ZERO
    if customer_id is not None:
        window_sum = _points(db.scalar(_filtered(
            select(func.coalesce(func.sum(PointRecord.delta), 0)),
            customer_id=customer_id, kinds=kinds, date_from=date_from, date_to=date_to,
        )))
        running = _points(opening + window_sum)
        if offset:
            newer = db.scalars(_filtered(
                select(PointRecord.delta), customer_id=customer_id, kinds=kinds,
                date_from=date_from, date_to=date_to,
            ).order_by(PointRecord.created_at.desc(), PointRecord.id.desc())
                .limit(offset)).all()
            running = _points(running - sum((_points(d) for d in newer), ZERO))

    docs = _doc_numbers(db, records)
    names: dict[int, str] = {}
    if customer_id is None and records:
        from src.models.customer import Customer

        ids = {r.customer_id for r in records}
        names = dict(db.execute(
            select(Customer.id, Customer.name).where(Customer.id.in_(ids))).all())

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
            "purse": (r.purse.value if hasattr(r.purse, "value")
                      else r.purse) or PURSE_BY_KIND.get(kind, PointPurse.both).value,
            "purse_label": PURSE_LABELS.get(
                (r.purse.value if hasattr(r.purse, "value") else r.purse)
                or PURSE_BY_KIND.get(kind, PointPurse.both).value, ""),
            "delta": str(delta),
            "earned": str(delta if delta > 0 else ZERO),
            "spent": str(-delta if delta < 0 else ZERO),
            "doc_kind": doc_kind,
            "doc_id": doc_id,
            "doc_number": docs.get((doc_kind, doc_id)) if doc_kind else None,
            "running": None,
        }
        if customer_id is not None:
            row["running"] = str(_points(running))
            running -= delta
        rows.append(row)

    return {
        "rows": rows,
        "count": count,
        "opening": str(opening),
        "earned": str(earned),
        "spent": str(-spent),
        "net": str(_points(earned + spent)),
        "balance": str(balance(db, customer_id)) if customer_id is not None else None,
    }


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
    purse: PointPurse | None = None,
    flush: bool = True,
) -> PointRecord:
    record = PointRecord(
        customer_id=customer_id,
        kind=kind,
        purse=purse or PURSE_BY_KIND.get(
            kind.value if hasattr(kind, "value") else str(kind), PointPurse.both),
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
