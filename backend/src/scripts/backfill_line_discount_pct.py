# -*- coding: utf-8 -*-
"""نسبة خصم السطر اللي الخصم نازل في فلوسها ومش مكتوب فيها.

`line_total` على السطر = الكمية × السعر × (١ − الخصم). ونقل a5 بياخد الإجمالي من
عنده (`a_price` = إجمالي السطر **بعد** الخصم) وبيكتب `discount_pct=ZERO` بالثابت.
فالسطر بيطلع صح في الفلوس وأخرس في السبب: العميل شايف ٢٠٨ × ١٠٠ والإجمالي ١٨٬٧٢٠
ومافيش خانة بتقول ليه.

معظم السطور اتصلّحت قبل كده — ٣٧٬٨٨٢ من ٣٨٬١٢١ سطر مخصوم عندهم النسبة. الباقي
٢٣٩ سطر بيع و٧ سطور شرا على ٥١ فاتورة، كلهم منقولين من a5.

## الرقم مش بيتخترع

النسبة بتتحسب من رقمين **محفوظين خلاص** على نفس السطر: `1 − line_total ÷ (كمية × سعر)`.
والتوزيع بيثبت إنه استرجاع مش تخمين — ١٠٪ و١٤٫٥٪ (يعني ١٠ وبعدها ٥) و٢٠٪ و١٥٪، مش
كسور عشوائية.

**و`line_total` مابيتلمسش.** الفلوس هي المرجع والقيد مترحّل عليها؛ اللي بيتزوّد هو
الشرح بس. السكريبت بيتأكد بنفسه إن مجموع الإجماليات ما اتغيّرش.

بيسيب السطر اللي إجماليه **أكبر** من الكمية × السعر (زيادة مش خصم — ٤ سطور) وبيقول
عليهم: نسبة سالبة معناها حاجة تانية خالص، وتسجيلها كخصم بيخفي السؤال.

    python -m src.scripts.backfill_line_discount_pct            # عرض بس
    python -m src.scripts.backfill_line_discount_pct --apply    # بيكتب
"""
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
    """النسبة اللي الأرقام نفسها بتقولها — أو `None` لو مافيش خصم ولا ينفع يتحسب."""
    raw = Decimal(str(row.quantity)) * Decimal(str(row.unit_price))
    if raw <= 0:
        return None
    total = Decimal(str(row.line_total))
    if total >= raw - CENT:          # مافيش خصم (أو زيادة — بتتساب)
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

        # الفلوس هي المرجع: مجموع الإجماليات لازم يفضل حرف بحرف.
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
