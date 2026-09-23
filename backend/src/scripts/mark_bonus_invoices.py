"""فواتير البونص القديمة — الفواتير اللي خصمها ١٠٠٪ بتتعلّم إنها بونص.

    python -m src.scripts.mark_bonus_invoices
    python -m src.scripts.mark_bonus_invoices --yes

---------------------------------------------------------------------------
قبل نوع «فاتورة بونص» البونص كان بيتكتب فاتورة بيع عادية بخصم ١٠٠٪ على المستند كله
(كلها جاية من a5). التعليم بيخلّيها تظهر في تقرير البونص من أول السنة وتخرج من إجماليات
المبيعات وعدّها — **ومابيغيّرش أي رقم**: القيمة صفر من الأول، والمخزون والتكلفة زي ما هم،
والرقم (`AL-S…`/`S…`) بيفضل زي ما هو عشان الورقة اللي في إيد العميل تفضل تشاور عليه.

**الربط بفاتورة البيع** بيتعمل لما يبقى واضح بس: فاتورة بيع واحدة بالظبط لنفس العميل في
نفس اليوم. أكتر من واحدة أو مافيش ⇒ البونص بيتعلّم من غير ربط — التخمين هنا بيربط هدية
بفاتورة غلط، والربط الفاضي بيقول الحقيقة («مش معروف»).

بيتعاد بأمان: اللي متعلّم خلاص بيتخطّى.
"""
from __future__ import annotations

import argparse
from collections import Counter

from sqlalchemy import or_, select

from src.core.db import SessionLocal
from src.models.sales import SalesInvoice


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true", help="نفّذ (من غيرها عرض بس)")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        todo = db.scalars(select(SalesInvoice).where(
            SalesInvoice.combined_pct >= 100,
            or_(SalesInvoice.is_bonus.is_(None), SalesInvoice.is_bonus.is_(False)),
        ).order_by(SalesInvoice.id)).all()
        print(f"فواتير خصمها ١٠٠٪ ومش متعلّمة: {len(todo):,}")

        stats: Counter = Counter()
        for inv in todo:
            candidates = db.scalars(select(SalesInvoice.id).where(
                SalesInvoice.customer_id == inv.customer_id,
                SalesInvoice.invoice_date == inv.invoice_date,
                SalesInvoice.id != inv.id,
                SalesInvoice.combined_pct < 100,
                or_(SalesInvoice.is_bonus.is_(None), SalesInvoice.is_bonus.is_(False)),
            )).all()
            inv.is_bonus = True
            if len(candidates) == 1:
                inv.bonus_for_invoice_id = candidates[0]
                stats["اتربطت بفاتورة"] += 1
            elif candidates:
                stats["أكتر من فاتورة في نفس اليوم — من غير ربط"] += 1
            else:
                stats["مافيش فاتورة بيع في نفس اليوم — من غير ربط"] += 1

        for k, v in stats.items():
            print(f"   {k}: {v:,}")

        if not args.yes:
            db.rollback()
            print("\n[عرض فقط] مافيش حاجة اتغيّرت. ضيف --yes للتنفيذ.")
            return
        db.commit()
        print(f"\n   ✓ اتعلّم {len(todo):,}.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
