# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.core.db import SessionLocal
from src.models.purchasing import PurchaseInvoiceLine, PurchaseReturnLine
from src.models.sales import SalesInvoiceLine, SalesReturnLine

CENT = Decimal("0.01")
TABLES = [
    ("سطور فواتير البيع", SalesInvoiceLine),
    ("سطور مرتجع البيع", SalesReturnLine),
    ("سطور فواتير الشرا", PurchaseInvoiceLine),
    ("سطور مرتجع الشرا", PurchaseReturnLine),
]


def _implied(row) -> Decimal | None:
    raw = Decimal(str(row.quantity)) * Decimal(str(row.unit_price))
    if raw <= 0:
        return None
    total = Decimal(str(row.line_total))
    if total >= raw - CENT:
        return None
    pct = (Decimal("100") * (Decimal("1") - total / raw)).quantize(CENT, ROUND_HALF_UP)
    return pct if Decimal("0") < pct < Decimal("100") else None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    db: Session = SessionLocal()
    try:
        grand = 0
        for label, model in TABLES:
            if not hasattr(model, "discount_pct"):
                print(f"{label:<22} — مافيش عمود خصم، اتخطّى")
                continue
            rows = db.scalars(
                select(model).where(
                    func.coalesce(model.discount_pct, 0) == 0,
                    model.line_total < model.quantity * model.unit_price - CENT,
                    model.quantity * model.unit_price > 0,
                )
            ).all()
            fixable = [(r, p) for r in rows if (p := _implied(r)) is not None]
            grand += len(fixable)
            dist: dict[Decimal, int] = {}
            for _r, p in fixable:
                dist[p] = dist.get(p, 0) + 1
            top = ", ".join(f"{p}%×{n}" for p, n in
                            sorted(dist.items(), key=lambda kv: -kv[1])[:4])
            print(f"{label:<22} {len(fixable):>5} سطر   {top}")
            if args.apply:
                for r, p in fixable:
                    r.discount_pct = p

        print()
        print(f"الإجمالي: {grand} سطر")
        if not args.apply:
            print()
            print("عرض بس — للكتابة زوّد --apply")
            return

        sums_before = {}
        for label, model in TABLES:
            sums_before[label] = db.scalar(select(func.sum(model.line_total)))
        db.flush()
        for label, model in TABLES:
            now = db.scalar(select(func.sum(model.line_total)))
            if now != sums_before[label]:
                db.rollback()
                raise SystemExit(f"اترفض: إجمالي «{label}» اتغيّر — {sums_before[label]} ← {now}")
        db.commit()
        print("اتكتب. ومجموع إجماليات السطور: زي ما هو في كل جدول ✔")

        left = db.scalar(select(func.count(SalesInvoiceLine.id)).where(
            func.coalesce(SalesInvoiceLine.discount_pct, 0) == 0,
            SalesInvoiceLine.line_total
            < SalesInvoiceLine.quantity * SalesInvoiceLine.unit_price - CENT,
            SalesInvoiceLine.quantity * SalesInvoiceLine.unit_price > 0))
        print(f"الباقي في سطور البيع من غير نسبة: {left}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
