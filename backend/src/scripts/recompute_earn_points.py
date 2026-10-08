from __future__ import annotations

import sys
from datetime import datetime, time
from decimal import Decimal

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.loyalty import PointKind, PointRecord, ProductPointValue
from src.models.sales import SalesInvoice, SalesInvoiceLine, SalesReturn, SalesReturnLine
from src.services import points_service

ZERO = Decimal("0.000")


def _points(value) -> Decimal:
    return Decimal(str(value if value is not None else 0)).quantize(Decimal("0.001"))


def _should_earn(db, line_model, doc_key) -> dict[int, Decimal]:
    rows = db.execute(
        select(doc_key, func.sum(ProductPointValue.point_value * line_model.quantity))
        .join(ProductPointValue, ProductPointValue.item_id == line_model.item_id)
        .group_by(doc_key)
    ).all()
    return {doc_id: _points(total) for doc_id, total in rows if doc_id is not None}


def _recorded(db, column, kinds) -> dict[int, Decimal]:
    rows = db.execute(
        select(column, func.sum(PointRecord.delta))
        .where(column.isnot(None), PointRecord.kind.in_(kinds))
        .group_by(column)
    ).all()
    return {doc_id: _points(total) for doc_id, total in rows if doc_id is not None}


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        should_inv = _should_earn(db, SalesInvoiceLine, SalesInvoiceLine.invoice_id)
        have_inv = _recorded(db, PointRecord.sales_invoice_id,
                             [PointKind.earn, PointKind.adjustment])
        invoices = {i.id: i for i in db.scalars(
            select(SalesInvoice).where(
                SalesInvoice.id.in_(set(should_inv) | set(have_inv)))).all()}

        should_ret = _should_earn(db, SalesReturnLine, SalesReturnLine.return_id)
        have_ret = _recorded(db, PointRecord.sales_return_id,
                             [PointKind.reverse, PointKind.adjustment])
        returns = {r.id: r for r in db.scalars(
            select(SalesReturn).where(
                SalesReturn.id.in_(set(should_ret) | set(have_ret)))).all()}

        fixes: list[tuple[str, int, Decimal, Decimal, Decimal]] = []
        for doc_id, doc in invoices.items():
            want = should_inv.get(doc_id, ZERO)
            have = have_inv.get(doc_id, ZERO)
            if want != have:
                fixes.append(("invoice", doc_id, have, want, _points(want - have)))
        for doc_id, doc in returns.items():
            want = -should_ret.get(doc_id, ZERO)
            have = have_ret.get(doc_id, ZERO)
            if want != have:
                fixes.append(("return", doc_id, have, want, _points(want - have)))

        up = sum((f[4] for f in fixes if f[4] > 0), ZERO)
        down = sum((f[4] for f in fixes if f[4] < 0), ZERO)
        print("=" * 56)
        print(f"{'فواتير بيع مفحوصة':<34}{len(invoices):>8}")
        print(f"{'مرتجعات مفحوصة':<34}{len(returns):>8}")
        print("-" * 56)
        print(f"{'مستندات محتاجة تصحيح':<34}{len(fixes):>8}")
        print(f"{'  منها فواتير':<34}{sum(1 for f in fixes if f[0] == 'invoice'):>8}")
        print(f"{'  منها مرتجعات':<34}{sum(1 for f in fixes if f[0] == 'return'):>8}")
        print(f"{'نقط هتتزوّد':<34}{up:>14,.3f}")
        print(f"{'نقط هتتخصم':<34}{down:>14,.3f}")
        print(f"{'الصافي':<34}{_points(up + down):>14,.3f}")

        if fixes:
            print("\nأكبر ١٥ فرق:")
            for kind, doc_id, have, want, delta in sorted(
                    fixes, key=lambda f: -abs(f[4]))[:15]:
                doc = invoices.get(doc_id) if kind == "invoice" else returns.get(doc_id)
                number = getattr(doc, "document_number", f"#{doc_id}")
                print(f"   {number:<16} متسجّل {have!s:>12} ⇐ المفروض {want!s:>12}"
                      f"   الفرق {delta!s:>12}")

        if not execute:
            print("\n[عرض فقط] مافيش حاجة اتحفظت. ضيف --yes للتنفيذ.")
            return

        written = 0
        for kind, doc_id, _have, _want, delta in fixes:
            doc = invoices.get(doc_id) if kind == "invoice" else returns.get(doc_id)
            if doc is None:
                continue
            customer_id = getattr(doc, "customer_id", None)
            if customer_id is None:
                continue
            when = getattr(doc, "invoice_date", None) or getattr(doc, "return_date", None)
            points_service.post(
                db,
                customer_id=customer_id,
                kind=PointKind.adjustment,
                delta=delta,
                sales_invoice_id=doc_id if kind == "invoice" else None,
                sales_return_id=doc_id if kind == "return" else None,
                created_at=datetime.combine(when, time.min) if when else None,
                flush=False,
            )
            written += 1
            if written % 500 == 0:
                db.flush()
        db.flush()
        db.commit()
        print(f"\n✔ اتكتب {written} سطر تصحيح.")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
