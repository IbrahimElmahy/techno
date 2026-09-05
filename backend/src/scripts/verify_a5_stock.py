"""يقارن رصيد كل صنف عندنا برصيد a5 — بنفس منطق المطابقة اللي الاستيراد استعمله. قراءة بس.

    python -m src.scripts.verify_a5_stock --dir C:/pgtmp
    python -m src.scripts.verify_a5_stock --dir C:/pgtmp/aliaa --prefix AL-

بيخرج بكود ١ لو فيه صنف مختلف أو صف a5 مالوش صنف — عشان يبقى بوابة في سلسلة البناء.

---------------------------------------------------------------------------
**المقارنة بالكود لوحده بتغلط.** كتير من سطور الحركة في a5 كودها فاضي، والاستيراد
طابقها بالاسم. فالمقارنة لازم تحلّ الصف بنفس الترتيب: الكود الأول، وبعده الاسم — وإلا
بتقارن صنف بصنف تاني وتقول «مختلف» على حاجة صح.

**رصيد a5 مشتق مش مخزّن.** `exp_bal.sql` بيجمع `n_count_unit` داخل لمخزن الوارد وخارج
من الصادر على `AzonDt` كله (بما فيه الافتتاحي `AznType=0`) — نفس القاعدة اللي المستورد
بيمشي عليها. فالاتنين بيتقاسوا بنفس المسطرة.

**الكتالوج بالبادئة.** كود a5 عدّاد جوّه كل شركة، فنفس الكود صنفين. `--prefix AL-` بيحدد
أصناف العلياء، والفاضي بيحدد أكتوبر باستبعاد `AL-`.

المرجع من آخر نقل سليم: ٥٦٢/٥٦٢ أكتوبر، ٢٠٧٨/٢٠٧٨ العلياء. الـ٦١٦ رصيد سالب حقيقة
a5 نفسها مش غلطة.
"""
from __future__ import annotations

import os
import sys
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.catalog import Item
from src.models.stock import StockDirection, StockMovement
from src.scripts.import_a5 import _clean, _money, _read, mine


def run(folder: str, prefix: str) -> None:
    path = os.path.join(folder, "a5_bal.tsv")
    if not os.path.exists(path):
        raise SystemExit(f"مافيش {path} — شغّل a5_sync.ps1 -ExportOnly الأول.")

    db = SessionLocal()
    try:
        items = mine(db.scalars(select(Item)).all(), prefix)
        by_code = {i.code: i for i in items if i.code}
        by_name = {i.name: i for i in items}

        ours: dict[int, Decimal] = defaultdict(Decimal)
        if items:
            for item_id, direction, qty in db.execute(
                    select(StockMovement.item_id, StockMovement.direction,
                           func.sum(StockMovement.quantity))
                    .where(StockMovement.item_id.in_([i.id for i in items]))
                    .group_by(StockMovement.item_id, StockMovement.direction)).all():
                ours[item_id] += Decimal(qty) * (1 if direction == StockDirection.in_ else -1)

        theirs: dict[int, Decimal] = defaultdict(Decimal)
        unresolved: list[str] = []
        for r in _read(path):
            if len(r) < 3:
                continue
            code, name, bal = _clean(r[0]), _clean(r[1]), _money(r[2])
            it = by_code.get(f"{prefix}{code}") or by_name.get(name)
            if it is None:
                if bal:
                    unresolved.append(f"«{name}» ({code}) = {bal}")
                continue
            theirs[it.id] += bal

        same = diff = 0
        worst = []
        for it in items:
            a = theirs.get(it.id, Decimal(0))
            b = ours.get(it.id, Decimal(0))
            if abs(a - b) < Decimal("0.001"):
                same += 1
            else:
                diff += 1
                worst.append((abs(a - b), it.name, it.code, a, b))

        label = prefix or "(أكتوبر)"
        print(f"الأصناف {label}: {len(items)}")
        print(f"   رصيدها مطابق لـa5    {same}")
        print(f"   مختلف                {diff}")
        print(f"   صفوف a5 مالهاش صنف   {len(unresolved)}")
        tot_ours = sum(ours.values())
        tot_theirs = sum(theirs.values())
        print(f"\nإجمالي الوحدات — a5: {tot_theirs:,}   عندنا: {tot_ours:,}"
              f"   الفرق: {tot_ours - tot_theirs:,}")
        if worst:
            worst.sort(reverse=True)
            print("\nالفروق:")
            for _d, name, code, a, b in worst[:20]:
                print(f"   {name[:34]:<36}{str(code):<14}a5={a:>12,.2f}  عندنا={b:>12,.2f}")
        if unresolved:
            print("\nصفوف a5 مالقيتش ليها صنف:")
            for u in unresolved[:10]:
                print("   " + u)
        if diff or unresolved:
            sys.exit(1)
        print("\n✔ مطابق.")
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp"
    prefix = args[args.index("--prefix") + 1] if "--prefix" in args else ""
    run(folder, prefix)
