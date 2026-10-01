"""خصم اللسته (الثابت) على سطور فواتير البونص — بيرجع.

    python -m src.scripts.fix_bonus_fixed_discount
    python -m src.scripts.fix_bonus_fixed_discount --yes

---------------------------------------------------------------------------
البونص ١٠٠٪ على إجمالي الفاتورة، والإجمالي ده **بعد خصم اللسته** (العميل ٢٠٢٦-١٠-٠١) —
زي فاتورة البيع: صنف بـ١٦٦٫٢٥ عليه ١٠٪ قيمته في البونص ١٤٩٫٦٣ مش ١٦٦٫٢٥.

`fix_bonus_line_discounts` (٢٠٢٦-٠٩-٢٩) صفّر الثابت والمتغيّر الاتنين على سطور البونص،
والسيرفر كان بيصفّرهم على أي بونص جديد — فالقيمة بقت بتطلع بالسعر كامل. السكربت ده بيرجّع
الثابت بنفس قاعدة الشاشة: خصم العميل لو متسجّل عليه، وإلا خصم الصنف.

**فواتير النظام الجديد بس** (`BNS-…`/`SINV-…` — المنقول من a5 أرقامه `AL-…` و`S…`): المنقول من a5 ماكانش عليه قسمة أصلاً،
وقيمته زي ما a5 سجّلها. بيلمس السطور اللي ثابتها صفر أو فاضي — اللي اتسجّل بخصم مابيتغيّرش.
الفلوس والقيود مابتتلمسش: سطر البونص قيمته صفر في الحالتين؛ ده رقم العرض بس.
"""
from __future__ import annotations

import argparse
from decimal import Decimal

from sqlalchemy import or_, select

from src.core.db import SessionLocal
from src.models.catalog import Item
from src.models.customer import Customer
from src.models.sales import SalesInvoice, SalesInvoiceLine


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true", help="نفّذ (من غيرها بيعرض بس)")
    args = ap.parse_args()
    db = SessionLocal()
    try:
        rows = db.execute(
            select(SalesInvoiceLine, SalesInvoice.document_number, Customer.discount_pct,
                   Item.default_discount_pct)
            .join(SalesInvoice, SalesInvoice.id == SalesInvoiceLine.invoice_id)
            .join(Customer, Customer.id == SalesInvoice.customer_id)
            .join(Item, Item.id == SalesInvoiceLine.item_id)
            .where(SalesInvoice.is_bonus.is_(True),
                   # أرقام النظام الجديد بس — المنقول من a5 أرقامه `AL-…` و`S…`.
                   or_(SalesInvoice.document_number.like("BNS-%"),
                       SalesInvoice.document_number.like("SINV-%")),
                   or_(SalesInvoiceLine.fixed_discount_pct.is_(None),
                       SalesInvoiceLine.fixed_discount_pct == 0))
        ).all()
        todo = []
        for line, num, cust_pct, item_pct in rows:
            pct = cust_pct if cust_pct is not None else item_pct
            if pct is not None and Decimal(pct) > 0:
                todo.append((line, num, Decimal(pct)))
        docs = sorted({n for _, n, _ in todo})
        print(f"{len(todo)} سطر في {len(docs)} فاتورة بونص: {', '.join(docs[:40])}")
        if not args.yes:
            print("عرض بس — شغّله بـ--yes عشان يتنفّذ.")
            return
        for line, _, pct in todo:
            line.fixed_discount_pct = pct
        db.commit()
        print("اترجع خصم اللسته.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
