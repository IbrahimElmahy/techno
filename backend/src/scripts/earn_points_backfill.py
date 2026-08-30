"""الكسب الرجعي: سطر نقاط لكل سطر فاتورة بيع على صنف له قيمة نقطة.

    python -m src.scripts.earn_points_backfill
    python -m src.scripts.earn_points_backfill --yes

**كسب بس.** الخصم مالوش ترحيل رجعي — المستخدم قرّر إن المعاينات القديمة مابتخصمش،
فمتضفش هنا ولا في سكربت تاني أي سطر سالب على معاينة قديمة.

**تاريخ السطر تاريخ الفاتورة، مش تاريخ التشغيل.** `created_at` بيتكتب صراحةً من
`invoice_date`. من غير كده أي كشف نقاط بفترة بيقول إن الشركة وزّعت نص مليون نقطة في
اليوم اللي شغّلنا فيه السكربت، وحركة أربع سنين بتتلم في صف واحد.

**Idempotent** بسطر لكل (فاتورة، سطر): السطور اللي اتكتبت قبل كده بتتعرف من
`sales_invoice_id` وبتتعدّى. إعادة التشغيل بتضيف الفواتير الجديدة بس.

الأرقام المتوقعة (اتقاست على قاعدة السيرفر قبل التنفيذ):
    ٢٨٧٩٠ سطر · ٥٤٦١ فاتورة · ٢٨١ عميل · ٤٦٦٩٧٥٫٧٧٦ نقطة
لو الأرقام طلعت بعيدة عن دي، وقّف وراجع — يا إما `product_point_value` مااتبذرتش
(شغّل `seed_item_points` الأول) يا إما فيه سطور اتكتبت قبل كده.
"""
from __future__ import annotations

import sys
from datetime import datetime
from decimal import Decimal

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.loyalty import PointKind, PointRecord, ProductPointValue
from src.models.sales import SalesInvoice, SalesInvoiceLine
from src.services import points_service

EXPECTED = {"lines": 28790, "invoices": 5461, "customers": 281,
            "points": Decimal("466975.776")}

# فرق مسموح قبل ما السكربت يقول «الرقم بعيد». الفواتير بتزيد يوم عن يوم، فالمساواة
# التامة هتشتكي من غير سبب بعد أول أسبوع؛ الهدف إمساك اختلاف كبير مش حركة يومين.
TOLERANCE = Decimal("0.02")   # ٢٪


def _points(value) -> Decimal:
    return Decimal(str(value if value is not None else 0)).quantize(Decimal("0.001"))


def _far(actual, expected) -> bool:
    expected = Decimal(str(expected))
    if expected == 0:
        return Decimal(str(actual)) != 0
    return abs(Decimal(str(actual)) - expected) / expected > TOLERANCE


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        values = {ppv.item_id: _points(ppv.point_value)
                  for ppv in db.scalars(select(ProductPointValue)).all()
                  if _points(ppv.point_value) > 0}
        print(f"أصناف عليها نقط: {len(values)}")
        if not values:
            raise SystemExit(
                "`product_point_value` فاضي — شغّل `python -m src.scripts.seed_item_points` الأول.")

        # الفواتير اللي ليها سطر كسب مكتوب قبل كده — استعلام واحد، مش واحد لكل فاتورة.
        done = set(db.scalars(
            select(PointRecord.sales_invoice_id).where(
                PointRecord.kind == PointKind.earn,
                PointRecord.sales_invoice_id.is_not(None),
            ).distinct()
        ).all())
        if done:
            print(f"فواتير ليها كسب متسجّل قبل كده (هتتعدّى): {len(done)}")

        rows = db.execute(
            select(SalesInvoiceLine.id, SalesInvoiceLine.invoice_id, SalesInvoiceLine.item_id,
                   SalesInvoiceLine.quantity, SalesInvoice.customer_id, SalesInvoice.invoice_date)
            .join(SalesInvoice, SalesInvoice.id == SalesInvoiceLine.invoice_id)
            .where(SalesInvoiceLine.item_id.in_(list(values)))
            .order_by(SalesInvoice.invoice_date, SalesInvoiceLine.invoice_id, SalesInvoiceLine.id)
        ).all()

        written = 0
        skipped_done = 0
        skipped_no_customer = 0
        total_points = Decimal("0")
        invoices: set[int] = set()
        customers: set[int] = set()

        for _line_id, invoice_id, item_id, quantity, customer_id, invoice_date in rows:
            if invoice_id in done:
                skipped_done += 1
                continue
            if customer_id is None:
                skipped_no_customer += 1
                continue
            delta = _points(values[item_id] * Decimal(str(quantity or 0)))
            if delta <= 0:
                continue
            # الفاتورة من غير تاريخ (لو حصل) بتاخد وقت الإنشاء بدل ما تقع في ١٩٧٠.
            when = (datetime.combine(invoice_date, datetime.min.time())
                    if invoice_date is not None else None)
            if execute:
                points_service.post(
                    db, customer_id=customer_id, kind=PointKind.earn, delta=delta,
                    sales_invoice_id=invoice_id, created_at=when, flush=False)
                if written % 1000 == 999:
                    db.flush()   # على دفعات — flush لكل سطر = ٢٨٧٩٠ رحلة للقاعدة
            written += 1
            total_points += delta
            invoices.add(invoice_id)
            customers.add(customer_id)

        print()
        print("=" * 52)
        print("الكسب الرجعي:")
        print("=" * 52)
        print(f"{'سطور نقاط':<30}{written:>18}")
        print(f"{'فواتير':<30}{len(invoices):>18}")
        print(f"{'عملاء':<30}{len(customers):>18}")
        print(f"{'إجمالي النقاط':<30}{total_points:>18}")
        if skipped_done:
            print(f"{'سطور اتعدّت (مكتوبة قبل كده)':<30}{skipped_done:>18}")
        if skipped_no_customer:
            print(f"{'سطور فاتورتها من غير عميل':<30}{skipped_no_customer:>18}")

        off = [
            name for name, actual, expected in (
                ("سطور", written, EXPECTED["lines"]),
                ("فواتير", len(invoices), EXPECTED["invoices"]),
                ("عملاء", len(customers), EXPECTED["customers"]),
                ("نقاط", total_points, EXPECTED["points"]),
            ) if _far(actual, expected)
        ]
        # المقارنة على التشغيل الأول بس. `written` بيعدّ الجديد لوحده، فإعادة تشغيل
        # بتلاقي ٣٠ سطر متأخرين كانت بتقارن الـ٣٠ بالـ٢٨٧٩٠ وتوقف وهي «واثقة».
        if off and not done:
            print()
            print("⚠ الأرقام بعيدة عن المتوقع في: " + "، ".join(off))
            print(f"  المتوقع: {EXPECTED['lines']} سطر · {EXPECTED['invoices']} فاتورة · "
                  f"{EXPECTED['customers']} عميل · {EXPECTED['points']} نقطة")
            print("  وقّف وراجع قبل ما تكمّل. مافيش حاجة اتحفظت.")
            return

        if not execute:
            print("\n[عرض فقط — DRY RUN] مافيش حاجة اتحفظت. ضيف --yes للتنفيذ الفعلي.")
            return

        db.commit()
        print("\n✔ اتحفظ الكسب الرجعي.")
        print(f"  رصيد الدفتر دلوقتي: "
              f"{_points(db.scalar(select(func.coalesce(func.sum(PointRecord.delta), 0))))}")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
