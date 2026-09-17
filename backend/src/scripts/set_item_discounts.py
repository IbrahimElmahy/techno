"""الخصم الثابت على الصنف من a5 (`SaleKhsm1`) — **عمود واحد وبس**.

    python -m src.scripts.set_item_discounts --dir C:/pgtmp
    python -m src.scripts.set_item_discounts --dir C:/pgtmp --yes
    python -m src.scripts.set_item_discounts --dir C:/pgtmp/aliaa --prefix AL- --yes

درايَ-رن بالافتراضي. بيكتب `Item.default_discount_pct` وخلاص — لا أسعار ولا أسماء ولا
فئات ولا عملاء.

---------------------------------------------------------------------------
**ليه سكربت لوحده بدل `import_a5`؟** `import_a5` بيقرا كشف العملاء كمان، وإعادة قراءته
بتعيد خلق الكروت اللي اتدمجت («تكنو فلان» مع «فلان»). الخصم حاجة صغيرة ومحددة، والتمنّ
ده غالي عليها.

**الخصم فين في a5.** `Items.SaleKhsm1..5` — خصم ثابت لكل سعر من الأسعار الخمسة. الأسعار
٢–٥ أصفار عند العميل ده، فالأول هو الوحيد الحيّ وخصمه هو الخصم: ٣٣٣ صنف في أكتوبر و٤١١
في العلياء عليهم ١٠٪. وسطر البيع في a5 بينزّلها فعلاً (`AzonDt.item_khsmp` = ١٠ في
٢٥٬٩٧١ سطر من ٢٨٬٥٧٩).

⚠️ **`ItmKhsm` مش الخصم** مهما كان اسمه بيقول كده. اتفحص على ٣٨ ألف سطر بيع: مابيطابقش
لا كنسبة ولا كمبلغ — ٥٣ سطر بس بيصادفوا من ٣٨٬٠٩٨. القراية من `SaleKhsm1` (عمود ١٤).

**والصنف اللي خصمه ١٠٠٪** (٣١ صنف في أكتوبر) بيتنقل زي ما هو — ده قرارهم، وسطره بصفر
عندهم زي ما هو عندنا. الواجهة بتقصّه على ٩٩٫٩٩ وقت الحساب، والرقم المخزّن بيفضل أمين
للمصدر.
"""
from __future__ import annotations

import os
import sys
from collections import Counter
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.catalog import Item
from src.scripts.import_a5 import _clean, _money, _read, mine

# عمود `SaleKhsm1` في `a5_items.tsv` بعد ما `exp_items.sql` اتوسّع.
COL_DISCOUNT = 14


def run(folder: str, prefix: str, *, execute: bool) -> int:
    db = SessionLocal()
    try:
        rows = _read(os.path.join(folder, "a5_items.tsv"))
        if not rows:
            print(f"مافيش a5_items.tsv في {folder}")
            return 2
        if len(rows[0]) <= COL_DISCOUNT:
            print(f"التصدير قديم ({len(rows[0])} عمود) — عايز {COL_DISCOUNT + 1} على الأقل.\n"
                  "شغّل التصدير تاني بـexp_items.sql الجديدة الأول.")
            return 2

        my_items = mine(db.scalars(select(Item)).all(), prefix)
        by_code = {i.code: i for i in my_items if i.code}
        by_name = {i.name: i for i in my_items}

        changes: list[tuple[Item, Decimal, Decimal]] = []
        unmatched = 0
        dist: Counter[str] = Counter()

        for r in rows:
            if len(r) <= COL_DISCOUNT or not r[0].isdigit():
                continue
            code, name = _clean(r[2]), _clean(r[3])
            it = by_code.get(f"{prefix}{code}") or by_name.get(name)
            if it is None:
                unmatched += 1
                continue
            new = _money(r[COL_DISCOUNT])
            if new < 0 or new > 100:
                continue
            old = Decimal(str(it.default_discount_pct or 0))
            if old != new:
                changes.append((it, old, new))
            dist[str(new)] += 1

        print(f"أصناف التصدير: {len(rows)}   اتطابقوا عندنا: {sum(dist.values())}"
              f"   مالهمش صنف: {unmatched}")
        print("\nتوزيع الخصم في a5:")
        for v, n in sorted(dist.items(), key=lambda x: -x[1])[:10]:
            print(f"   {v:>8} : {n}")

        print(f"\nهيتغيّر عندنا: {len(changes)} صنف")
        for it, old, new in changes[:15]:
            print(f"   {it.code:<16}{it.name[:30]:<32}{old} ← {new}")
        if len(changes) > 15:
            print(f"   … و{len(changes) - 15} كمان")

        if not execute:
            print("\nدرايَ-رن. `--yes` عشان ينفّذ.")
            return 0

        for it, _old, new in changes:
            it.default_discount_pct = new
        db.commit()
        print(f"\nاتكتب: {len(changes)} صنف.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp"
    prefix = args[args.index("--prefix") + 1] if "--prefix" in args else ""
    sys.exit(run(folder, prefix, execute="--yes" in args))
