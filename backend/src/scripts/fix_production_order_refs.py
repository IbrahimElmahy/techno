# -*- coding: utf-8 -*-
"""رقم أمر التشغيل المنقول — الورقة اللي في إيدهم، مش الرقم اللي لفّقناه.

    python -m src.scripts.fix_production_order_refs
    python -m src.scripts.fix_production_order_refs --yes

`backfill_production_orders` كان بيحطّ `FC-MFG-3537` في `external_document_number`.
والحقل ده معناه **رقم المستند عند صاحبه** — واللي بيدوّر على أمر شغل بيدوّر بالرقم
المكتوب على الورقة في المصنع، وهو **٣٥٣٧**.

و`FC-MFG-3537` رقم من تلفيقنا: `FC-` بادئة الفرع، و`MFG` كلمة حطّيناها عشان نرقّم
العمليات — ومالهمش وجود في a5. يعني الكشف كان بيوري رقمين، الاتنين من عندنا، ومافيش
فيهم الرقم اللي الراجل ماسكه في إيده.

**ورقمنا الداخلي مابيتغيّرش** (`WO-A5-FC-MFG-3537`): هو مفتاح المستند، والروابط
و`backfill` بيتقاسوا بيه. اللي بيتصلّح هو الحقل اللي الشاشة بتعرضه على إنه سند الأمر.

بيتعاد بأمان: الصف اللي رقمه متصلّح خلاص بيتخطّى.
"""
from __future__ import annotations

import argparse

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.manufacturing import ProductionOrder


def main() -> None:
    ap = argparse.ArgumentParser(description="تصحيح رقم أمر التشغيل المنقول")
    ap.add_argument("--source", default="a5", help="قيمة `imported_from`")
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--limit", type=int, default=10)
    args = ap.parse_args()

    db = SessionLocal()
    try:
        rows = db.scalars(select(ProductionOrder)
                          .where(ProductionOrder.imported_from == args.source)
                          .order_by(ProductionOrder.id)).all()
        changed = []
        for o in rows:
            old = o.external_document_number or ""
            new = old.rsplit("-", 1)[-1]
            if not new or new == old:
                continue
            changed.append((o.document_number, old, new))
            if args.yes:
                o.external_document_number = new[:40]

        print(f"{'أوامر منقولة':<28}{len(rows):>8,}")
        print(f"{'رقمها هيتصلّح':<28}{len(changed):>8,}")
        if changed:
            print(f"\n{'المستند':<24}{'كان':>18}{'بقى':>10}")
            for doc, old, new in changed[: args.limit]:
                print(f"{doc:<24}{old:>18}{new:>10}")
            if len(changed) > args.limit:
                print(f"   … و{len(changed) - args.limit:,} أمر تاني")

        if not args.yes:
            print("\n[عرض فقط] مافيش حاجة اتغيّرت. ضيف --yes للتنفيذ.")
            return
        db.commit()
        print(f"\n   ✓ اتصلّح {len(changed):,}.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
