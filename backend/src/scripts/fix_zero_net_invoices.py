"""يصلّح `net` الصفري على فواتير قيمتها مش صفر — ١٫٨ مليون مبيعات كانت مخفية.

    python -m src.scripts.fix_zero_net_invoices          # يعرض بس
    python -m src.scripts.fix_zero_net_invoices --yes    # ينفّذ

**اللي اتكشف وأنا بفحص الـ٦٥٤ فاتورة اللي بلا قيد:**

الـ٦٥٤ دول طلعوا **مش مشكلة**: صافيهم صفر فعلاً، وقيد البيع عندنا فيه حسابات الطرف
والخزنة بس (المخزون مابيترحّلش على الدفتر) — يعني مافيش حاجة تتقيّد، وغياب القيد صح.

اللي **هو** مشكلة اتكشف جنبهم: **٧٢٧ فاتورة `net = 0` وسطورها بقيمة حقيقية**، وقيدها
في الدفتر بقيمة حقيقية كمان. واحدة فيهم بـ١٣٢٬٦٠٦ ج. الإجمالي المخفي **١٬٨١١٬١١٩٫٩٥ ج**.

يعني `gross` صح، والسطور صح، والقيد صح — و`net` وحده اللي فاضي. حقل `Emali_aftr` في
تصدير a5 بيرجع صفر على الصفوف دي، والاستيراد أخده زي ما هو.

**والأثر مش شكلي:** أي تقرير بيقرا `net` (المبيعات، الربحية، مبيعات المندوب) بيقلّ
بـ١٫٨ مليون. الدفتر سليم — فالرقمين بيتعارضوا، والواحد بيبص على التقرير ويقول عن
الدفتر إنه غلط.

**الإصلاح:** `net = gross` على الصفوف دي. والعلاقة دي مقيسة مش مفترضة — في الفواتير
السليمة `net = gross` في ٦٬٥٢٢ من ٦٬٦٠٥ (٩٨٫٧٪)، و`net` = مجموع السطور في ٦٬٢٢٣.
والسكربت **بيتحقق قبل ما يكتب** إن `gross` بيساوي مجموع السطور على كل صف بيلمسه —
اللي مايطابقش بيتقال ومايتغيّرش.

**مابيتلمسش:** الفواتير اللي صافيها صفر فعلاً (سطورها صفر)، ولا أي قيد، ولا `gross`.
"""
from __future__ import annotations

import sys
from decimal import Decimal

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.sales import SalesInvoice, SalesInvoiceLine

TOLERANCE = Decimal("0.02")


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        rows = db.scalars(select(SalesInvoice).where(SalesInvoice.net == 0)).all()

        fixable: list[tuple[SalesInvoice, Decimal]] = []
        mismatched: list[tuple[SalesInvoice, Decimal, Decimal]] = []
        truly_zero = 0

        for inv in rows:
            lines_total = db.scalar(
                select(func.coalesce(func.sum(SalesInvoiceLine.line_total), 0))
                .where(SalesInvoiceLine.invoice_id == inv.id)) or Decimal("0")
            lines_total = Decimal(lines_total)
            if lines_total == 0:
                truly_zero += 1
                continue
            gross = Decimal(inv.gross or 0)
            # الحارس: `gross` هو اللي هيتنقل لـ`net`، فلازم يكون هو نفسه سليم. الصف
            # اللي `gross` بتاعه مش مطابق لسطوره مش عارفين قيمته الصح — فبيتقال
            # ومايتغيّرش. تخمين رقم فلوس أوحش من تركه فاضي: الفاضي بيتشاف.
            if abs(gross - lines_total) > TOLERANCE:
                mismatched.append((inv, gross, lines_total))
                continue
            fixable.append((inv, gross))

        total = sum((g for _i, g in fixable), Decimal("0"))
        print(f"فواتير `net = 0`:                      {len(rows):>6}")
        print(f"   صافيها صفر فعلاً (سليمة، مش هتتلمس): {truly_zero:>6}")
        print(f"   هيتصلّح (gross = مجموع السطور):      {len(fixable):>6}")
        print(f"   gross مش مطابق لسطوره (هيتقال بس):   {len(mismatched):>6}")
        print(f"\nالقيمة اللي هترجع تبان: {total:,.2f} ج")

        if fixable:
            print("\nأكبر خمسة:")
            for inv, g in sorted(fixable, key=lambda r: -r[1])[:5]:
                print(f"   {inv.document_number:<14}{inv.invoice_date}   {g:>14,.2f}")

        if mismatched:
            print("\n⚠️ مش هيتغيّروا — `gross` مش مطابق لسطورهم:")
            for inv, g, lt in mismatched[:10]:
                print(f"   {inv.document_number:<14}gross={g:,.2f}   سطور={lt:,.2f}")
            if len(mismatched) > 10:
                print(f"   ... و{len(mismatched) - 10} غيرهم")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for inv, gross in fixable:
            inv.net = gross
        db.commit()

        left = db.scalar(
            select(func.count()).select_from(SalesInvoice)
            .where(SalesInvoice.net == 0, SalesInvoice.gross != 0)) or 0
        shown = db.scalar(select(func.coalesce(func.sum(SalesInvoice.net), 0))) or 0
        print(f"\n✔ اتصلّح {len(fixable)} فاتورة.")
        print(f"   لسه `net=0` و`gross` مش صفر: {left}")
        print(f"   إجمالي المبيعات دلوقتي: {Decimal(shown):,.2f} ج")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
