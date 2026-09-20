"""تركيبات الإنتاج (الوصفات) من a5 — `Nsb_entag` و`Nsb_EntagDt`.

    python -m src.scripts.import_a5_boms --dir /opt/techno/a5factory --branch السادات --prefix FC-
    python -m src.scripts.import_a5_boms --dir ... --branch ... --prefix ... --yes

بيتعاد تشغيله بأمان: المنتج اللي له وصفة فعّالة عندنا بيتخطى.

---------------------------------------------------------------------------
**دي للشغل الجاي مش للأرصدة.** الأرصدة ظبطت من `import_a5_manufacturing` اللي بيعيد
تشغيل الحركة الفعلية. الوصفة بتقول «المنتج ده بيتعمل من إيه» — يعني اللي بيعمل أمر
تصنيع جديد يلاقي الخامات جاهزة بدل ما يكتبها بإيده كل مرة.

تلات قرارات:

* **الكمية = `Nsb_units + Nsb_Single ÷ units`.** a5 بيمسك الكمية على جزئين: وحدات
  كاملة وأجزاء، و`units` هو المقام (١٠٠٠ جرام في الكيلو). سطر «٧٢ من ١٠٠٠ كجم» معناه
  ٠٫٠٧٢ كجم — واللي يقرا `Nsb_units` وحده بيلاقي صفر ويفتكر السطر فاضي. و٩٤٪ من
  السطور شكلها كده.

* **السطور بتتكتب مباشرةً، مش عن طريق `create_bom`.** التحقق بيطلب إن كل مكوّن
  `raw_material` وكل ناتج `product`؛ ونقل a5 عمل **كل** الأصناف `product` لأن a5
  مافيهوش التفرقة دي أصلاً. النداء على `create_bom` كان هيرفض الـ٤١٠ وصفة كلهم.
  والحل التاني — إننا نقلب المكوّنات لـ`raw_material` — أسوأ: «تشغيل كوع ٢٥» بيتنتج
  وبيتستهلك، فتسميته خامة بتمنع إنتاجه. فالوصفة بتتكتب زي ما هي، والتفرقة تتعمل
  بعدين لما يتقرر مين خامة ومين منتج فعلاً.

* **تكاليف a5 بتتنقل كموارد.** `Agor` أجور و`Khrba` كهربا و`Meah` مياه و`Wkod` وقود —
  أربعتهم أرقام على رأس الوصفة. بتتكتب `BomResource` من نوع `labor` للأجور
  و`overhead` للباقي، بكمية ١ وسعر = المبلغ. الصفر مابيتكتبش: مورد بصفر بيزوّد سطر
  في الشاشة مابيقولش حاجة.
"""
from __future__ import annotations

import argparse
import os
import sys
from collections import Counter, defaultdict
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.core.money import to_money, to_qty
from src.models.bom import Bom, BomComponent, BomResource, ResourceKind
from src.models.catalog import Item
from src.scripts.import_a5 import _clean, _money, _read

#: أعمدة `a5_bom.tsv` — رأس الوصفة
(B_JID, B_ITEM, B_CODE, B_NAME, B_OUT, B_AGOR, B_KHRBA, B_MEAH, B_WKOD, B_WK) = range(10)
#: أعمدة `a5_bomline.tsv` — سطر خامة
(L_ITEM, L_PNAME, L_RAWID, L_RAWNAME, L_RAWCODE, L_UNITS, L_SINGLE, L_DIV, L_UNITN) = range(9)

#: تكاليف a5 → نوع المورد عندنا واسمه العربي.
COSTS = ((B_AGOR, ResourceKind.labor, "أجور"),
         (B_KHRBA, ResourceKind.overhead, "كهرباء"),
         (B_MEAH, ResourceKind.overhead, "مياه"),
         (B_WKOD, ResourceKind.overhead, "وقود"))


def _qty_of(r: list[str]) -> Decimal:
    """كمية الخامة لكل وحدة ناتج: الوحدات الكاملة + الأجزاء على المقام."""
    whole = _money(r[L_UNITS])
    part = _money(r[L_SINGLE])
    div = _money(r[L_DIV]) or Decimal(1)
    return to_qty(whole + (part / div if div else Decimal(0)))


def run(folder: str, *, execute: bool, prefix: str) -> None:
    heads = [r for r in _read(os.path.join(folder, "a5_bom.tsv")) if len(r) >= 10]
    lines = [r for r in _read(os.path.join(folder, "a5_bomline.tsv")) if len(r) >= 9]

    by_product: dict[str, list[list[str]]] = defaultdict(list)
    for r in lines:
        by_product[_clean(r[L_ITEM])].append(r)

    print("المصدر:")
    print(f"   وصفات                {len(heads):>7}")
    print(f"   سطور خامات           {len(lines):>7}")
    print(f"   منتجات ليها سطور     {len(by_product):>7}")
    if not execute:
        print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
        return

    db = SessionLocal()
    try:
        by_code = {i.code: i for i in db.scalars(select(Item)).all()}
        by_name: dict[str, Item] = {}
        for i in by_code.values():
            by_name.setdefault(i.name, i)

        def find(code: str, name: str) -> Item | None:
            return by_code.get(f"{prefix}{_clean(code)}") or by_name.get(_clean(name))

        has_bom = {b.product_id for b in db.scalars(
            select(Bom).where(Bom.active.is_(True))).all()}

        made = Counter()
        skipped: list[str] = []
        for h in heads:
            a5_item = _clean(h[B_ITEM])
            rows = by_product.get(a5_item, [])
            if not rows:
                skipped.append("وصفة مالهاش سطور خامات")
                continue
            product = find(h[B_CODE], h[B_NAME])
            if product is None:
                skipped.append(f"منتج مش موجود: «{_clean(h[B_NAME])}»")
                continue
            if product.id in has_bom:
                made["وصفات موجودة"] += 1
                continue

            comps: dict[int, Decimal] = {}
            for r in rows:
                qty = _qty_of(r)
                if qty <= 0:
                    continue          # مكوّن مكتوب وكميته صفر — بيتساب
                raw = find(r[L_RAWCODE], r[L_RAWNAME])
                if raw is None:
                    skipped.append(f"خامة مش موجودة: «{_clean(r[L_RAWNAME])}»")
                    continue
                # a5 بيكرّر نفس الخامة في وصفة واحدة؛ عندنا سطر واحد بالمجموع.
                comps[raw.id] = comps.get(raw.id, Decimal(0)) + qty
            if not comps:
                skipped.append(f"وصفة كل خاماتها بصفر: «{_clean(h[B_NAME])}»")
                continue

            out = _money(h[B_OUT]) or Decimal(1)
            bom = Bom(product_id=product.id, name=f"وصفة {product.name}"[:160],
                      output_quantity=to_qty(out), active=True)
            db.add(bom)
            db.flush()
            for item_id, qty in comps.items():
                db.add(BomComponent(bom_id=bom.id, item_id=item_id,
                                    quantity=to_qty(qty), unit=None, unit_factor=to_qty(1)))
            for idx, kind, label in COSTS:
                val = _money(h[idx])
                if val > 0:
                    db.add(BomResource(bom_id=bom.id, kind=kind, name=label,
                                       quantity=to_qty(1), rate=to_money(val)))
                    made["موارد"] += 1
            has_bom.add(product.id)
            made["وصفات"] += 1
            made["سطور خامات"] += len(comps)

        db.commit()
        print("\nالكيان               اتعمل")
        print("-" * 28)
        for k, v in made.most_common():
            print(f"{k:<22}{v:>6}")
        if skipped:
            c = Counter(skipped)
            print(f"\nاتخطّى {len(skipped)}، {len(c)} سبب:")
            for s, n in c.most_common(15):
                print(f"   {n:>5} × {s}")
        print("\nتم.")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="استيراد وصفات الإنتاج من a5")
    ap.add_argument("--dir", required=True)
    ap.add_argument("--branch", default="")      # مقبول للاتساق، الوصفة مالهاش فرع
    ap.add_argument("--prefix", default="")
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args()
    run(a.dir, execute=a.yes, prefix=a.prefix)


if __name__ == "__main__":
    main()
