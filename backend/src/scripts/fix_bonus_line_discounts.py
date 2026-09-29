"""سطور فواتير البونص — من غير خصم ثابت ولا متغيّر على السطر.

    python -m src.scripts.fix_bonus_line_discounts
    python -m src.scripts.fix_bonus_line_discounts --yes

---------------------------------------------------------------------------
البونص ١٠٠٪ على **إجمالي الفاتورة** تحت، مش على كل سطر (قرار العميل ٢٠٢٦-٠٩-٢٩).
التطبيق كان بيبعت المتغيّر ١٠٠ على كل سطر والسيرفر بيخزّنه زي ما هو، فالفاتورة لما
بتتفتح في النظام بيبان «خصم متغير ١٠٠٪» على كل صنف.

السكربت بيصفّر **نصّي العرض بس** (`fixed_discount_pct` و`variable_discount_pct`) على سطور
فواتير البونص. `discount_pct` (١٠٠) و`line_total` (صفر) والقيود والمخزون مابيتلمسوش —
الفلوس ماكانتش غلط، العرض بس. بيتعاد بأمان.
"""
from __future__ import annotations

import argparse

from sqlalchemy import or_, select

from src.core.db import SessionLocal
from src.core.money import ZERO
from src.models.sales import SalesInvoice, SalesInvoiceLine


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true", help="نفّذ (من غيرها بيعرض بس)")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        rows = db.execute(
            select(SalesInvoiceLine, SalesInvoice.document_number)
            .join(SalesInvoice, SalesInvoice.id == SalesInvoiceLine.invoice_id)
            .where(SalesInvoice.is_bonus.is_(True))
            .where(or_(SalesInvoiceLine.fixed_discount_pct.is_(None),
                       SalesInvoiceLine.fixed_discount_pct != 0,
                       SalesInvoiceLine.variable_discount_pct.is_(None),
                       SalesInvoiceLine.variable_discount_pct != 0))
        ).all()
        docs = sorted({num for _, num in rows})
        print(f"{len(rows)} سطر في {len(docs)} فاتورة بونص: {', '.join(docs[:40])}"
              + (" …" if len(docs) > 40 else ""))
        if not args.yes:
            print("عرض بس — شغّله بـ--yes عشان يتنفّذ.")
            return
        for line, _ in rows:
            line.fixed_discount_pct = ZERO
            line.variable_discount_pct = ZERO
        db.commit()
        print("اتصفّروا.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
