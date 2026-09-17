"""رصيد الصنف في كل مخزن — **مقروء من a5 مباشرةً**، مقابل رصيدنا. قراءة بس.

    python -m src.scripts.verify_a5_live_by_store --dir C:/pgtmp
    python -m src.scripts.verify_a5_live_by_store --dir C:/pgtmp/aliaa --prefix AL-

بيقرا `a5_bal_store.tsv` اللي `exp_bal_by_store.sql` بيطلّعه — **a5 هو اللي بيجمع، مش
إحنا**. الفرق عن `verify_a5_stock_by_store` مش في النتيجة المتوقعة، في مين بيحسب:

* `verify_a5_stock_by_store` بيقرا سطور الحركة الخام (`a5_lines.tsv`) **ويعيد تجميعها
  في بايثون** — بطيّ التحويل وقراءة أول المدة من ملف تاني. أي غلطة في الطيّ أو في
  ترتيب الأعمدة بتطلع «فرق» مالوش وجود.
* ده بياخد رقم **مجمَّع جوّه SQL Server** على الجدول نفسه. مافيش طيّ في بايثون ومافيش
  ملفين يتلموا، فلو الاتنين اتفقوا يبقى الطيّ صح، ولو اختلفوا يبقى المشكلة في قراءتنا
  مش في الداتا.

**والصنف بيتحلّ بالكود الأول وبعده بالاسم** — نفس ترتيب المستورد بالحرف. المطابقة
بالكود لوحده بتغلط: سطور كتير في a5 كودها فاضي واتنقلت بالاسم.
"""
from __future__ import annotations

import os
import sys
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.catalog import Item
from src.models.stock import LocationKind, StockDirection, StockMovement
from src.models.warehouse import Warehouse
from src.scripts.import_a5 import _clean, _money, _read, mine

ZERO = Decimal("0")


def run(folder: str, prefix: str) -> int:
    db = SessionLocal()
    try:
        path = os.path.join(folder, "a5_bal_store.tsv")
        rows = _read(path)
        if not rows:
            print(f"مافيش {path} — شغّل تصدير `exp_bal_by_store.sql` الأول.")
            return 2

        my_items = mine(db.scalars(select(Item)).all(), prefix)
        by_code = {i.code: i for i in my_items if i.code}
        by_name = {i.name: i for i in my_items}
        names = {i.id: i.name for i in my_items}

        wh = {w.name.strip(): w for w in db.scalars(select(Warehouse)).all()}
        wh_name = {w.id: w.name for w in wh.values()}

        theirs: dict[tuple[int, int], Decimal] = defaultdict(Decimal)
        no_item = no_store = 0
        unknown_stores: dict[str, int] = defaultdict(int)

        for r in rows:
            if len(r) < 4:
                continue
            code, name, store = _clean(r[0]), _clean(r[1]), _clean(r[2])
            it = by_code.get(f"{prefix}{code}") or by_name.get(name)
            if it is None:
                no_item += 1
                continue
            w = wh.get(store)
            if w is None:
                no_store += 1
                unknown_stores[store] += 1
                continue
            theirs[(it.id, w.id)] += Decimal(str(_money(r[3])))

        ours: dict[tuple[int, int], Decimal] = defaultdict(Decimal)
        for item_id, loc_id, direction, qty in db.execute(
            select(StockMovement.item_id, StockMovement.location_id,
                   StockMovement.direction, func.sum(StockMovement.quantity))
            .where(StockMovement.location_kind == LocationKind.warehouse,
                   StockMovement.item_id.in_([i.id for i in my_items]))
            .group_by(StockMovement.item_id, StockMovement.location_id,
                      StockMovement.direction)
        ).all():
            v = Decimal(str(qty or 0))
            ours[(item_id, loc_id)] += v if direction == StockDirection.in_ else -v

        keys = set(theirs) | set(ours)
        diff = [(k, theirs.get(k, ZERO), ours.get(k, ZERO))
                for k in keys if theirs.get(k, ZERO) != ours.get(k, ZERO)]
        diff.sort(key=lambda x: -abs(x[1] - x[2]))

        print(f"صفوف a5 (مجمّعة عندهم): {len(rows)}")
        print(f"أزواج (صنف × مخزن): {len(keys)}")
        print(f"   مطابق              {len(keys) - len(diff)}")
        print(f"   مختلف              {len(diff)}")
        if no_item:
            print(f"   صفوف a5 مالهاش صنف {no_item}")
        if unknown_stores:
            print("\nمخازن في a5 مش عندنا:")
            for nm, n in sorted(unknown_stores.items(), key=lambda x: -x[1]):
                print(f"   «{nm}» — {n} صف")

        if diff:
            gap = sum((a - b for _k, a, b in diff), ZERO)
            print(f"\nإجمالي الفرق (a5 − عندنا): {gap}")
            print(f"\n{'الصنف':<32}{'المخزن':<20}{'a5':>12}{'عندنا':>12}{'الفرق':>10}")
            print("-" * 88)
            for (item_id, loc_id), a, b in diff[:60]:
                print(f"{names.get(item_id, str(item_id))[:30]:<32}"
                      f"{wh_name.get(loc_id, str(loc_id))[:18]:<20}"
                      f"{a:>12}{b:>12}{a - b:>10}")
            if len(diff) > 60:
                print(f"… و{len(diff) - 60} صف كمان")
        else:
            print("\n✔ كل صنف في كل مخزن مطابق.")
        return 1 if diff else 0
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp"
    prefix = args[args.index("--prefix") + 1] if "--prefix" in args else ""
    sys.exit(run(folder, prefix))
