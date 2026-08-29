"""يزامن قوائم الإعدادات مع اللي الداتا مستعملاه فعلاً — الفئات والوحدات.

الاستيراد كتب فئة a5 على الصنف مباشرة، والقائمة في «الإعدادات» فضلت على الأربعة
الافتراضيين اللي اتزرعوا مع النظام. النتيجة: ٤٦ فئة حقيقية على ٢٦٤٠ صنف، وصفر منها في
القائمة — فالفلتر والقائمة المنسدلة بيعرضوا فئات وهمية، واللي عايز يفلتر على «تكنو ثيرم»
مالقاهاش.

    python -m src.scripts.sync_a5_lookups          # يعرض بس
    python -m src.scripts.sync_a5_lookups --yes    # ينفّذ

بيتعاد تشغيله بأمان.

---------------------------------------------------------------------------
تلات قرارات:

* **القيمة بتتاخد من الداتا مش من قائمة مكتوبة هنا.** أي فئة على أي صنف بتدخل القائمة.
  قائمة مكتوبة في السكربت بتقدم أول ما حد يضيف فئة من الشاشة.

* **الافتراضي اللي مافيش صنف عليه بيتقفل مابيتشالش.** «مواسير» و«لحامات» اتزرعوا مع
  النظام ومش مستعملين هنا. الحذف بيكسر أي صنف اتصنّف بيهم بعدين؛ القفل بيشيلهم من
  القائمة المنسدلة وبيسيبهم يرجعوا بضغطة.

* **الوحدة الفاضية بتتصلّح.** فيه صنف وحدته `+` — رمز اتكتب في خانة اسم. بيبقى «قطعة»،
  لأن صنف بلا وحدة مايتباعش.
"""
from __future__ import annotations

import re
import sys
from collections import Counter

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.catalog import Item
from src.models.lookup import LookupOption

# اسم من دول مش اسم — رمز اتكتب في الخانة.
JUNK = re.compile(r"^[\s.\-_0-9@#*/\\+]+$")

DEFAULT_UNIT = "قطعة"


def _sync(db, category: str, used: Counter, *, execute: bool) -> dict[str, int]:
    have = {o.value: o for o in db.scalars(
        select(LookupOption).where(LookupOption.category == category)).all()}
    order = max([o.sort_order for o in have.values()] or [0])

    added = [v for v in used if v not in have]
    stale = [v for v, o in have.items() if v not in used and o.active and not o.is_system]

    print(f"\n«{category}» — مستعمل في الداتا: {len(used)}   في القائمة: {len(have)}")
    if added:
        print(f"   هيتضاف {len(added)}:")
        for v in sorted(added, key=lambda x: -used[x])[:12]:
            print(f"      {v:<26}{used[v]:>6} صنف")
        if len(added) > 12:
            print(f"      … و{len(added) - 12} غيرهم")
    if stale:
        print(f"   هيتقفل (مافيش صنف عليه) {len(stale)}: " + "، ".join(stale[:8]))
    if not added and not stale:
        print("   مظبوط — مافيش تغيير")

    if not execute:
        return {"اتضاف": 0, "اتقفل": 0}

    for v in sorted(added, key=lambda x: -used[x]):
        order += 1
        db.add(LookupOption(category=category, value=v, label=v,
                            sort_order=order, active=True, is_system=False))
    for v in stale:
        have[v].active = False
    return {"اتضاف": len(added), "اتقفل": len(stale)}


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        items = db.scalars(select(Item)).all()

        # وحدة فاضية أو رمز = مش وحدة. بتتصلّح قبل ما تتزامن، وإلا الرمز بيدخل القائمة.
        broken = [i for i in items
                  if not (i.unit_of_measure or "").strip()
                  or JUNK.match((i.unit_of_measure or "").strip())]
        if broken:
            print(f"أصناف وحدتها رمز أو فاضية: {len(broken)} — هتبقى «{DEFAULT_UNIT}»")
            for i in broken[:6]:
                print(f"   {i.code:<16}{i.name[:30]:<32}«{i.unit_of_measure}»")
        if execute:
            for i in broken:
                i.unit_of_measure = DEFAULT_UNIT
            db.flush()

        cats = Counter(c for c in ((i.category or "").strip() for i in items)
                       if c and not JUNK.match(c))
        units = Counter(u for u in ((i.unit_of_measure or "").strip() for i in items)
                        if u and not JUNK.match(u))

        done = {}
        done["الفئات"] = _sync(db, "item_category", cats, execute=execute)
        done["الوحدات"] = _sync(db, "unit_of_measure", units, execute=execute)

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return
        db.commit()
        print(f"\n{'القائمة':<12}{'اتضاف':>8}{'اتقفل':>8}")
        print("-" * 28)
        for k, v in done.items():
            print(f"{k:<12}{v['اتضاف']:>8}{v['اتقفل']:>8}")
        print(f"وحدات اتصلّحت: {len(broken)}")
        print("\nتم.")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
