"""يملا الكروت اللي **مالهاش** قيمة نقطة في `product_point_value` من جدول قواعد العميل.

    python -m src.scripts.seed_item_points_from_rules            # عرض فقط
    python -m src.scripts.seed_item_points_from_rules --yes
    python -m src.scripts.seed_item_points_from_rules --audit    # يقارن باللي محطوط

**مابيلمسش قيمة العميل أبداً.** الـ٤١٠ كارت اللي فيها قيم دلوقتي جايين من ملف
`points.tsv` اللي العميل كتبه بإيده، وفيه أحكام مش مشتقّة من الجدول: «جلبة اصلاح 4"»
بنقطتين مع إن قطعة الصرف ٤ بوصة نقطة واحدة. المحرك بيتفق مع الملف في ٩٠٪ من الكروت،
والـ١٠٪ الباقية هي بالظبط الأحكام دي — فلو كتبنا فوقها نكون مسحنا قرار العميل بحساب
آلي. `--overwrite` موجودة للحالة اللي هو يطلبها بنفسه، ومش الافتراضي.

اللي بيتكتب هو `sale_points`: نقط **وحدة البيع** مش المتر. جدول العميل بالمتر،
والفاتورة بتعدّ لفف — فالماسورة بتتضرب في طول لفتها (٤ متر للبولى، ٦ للصرف). التأكيد
من ملف العميل نفسه: ماسورة ٦٣ بولى ١٦ نقطة = ٤ × ٤، وماسورة صرف ٦ بوصة ١٣ = ١٣/٦ × ٦.

الكارت اللي مالوش قاعدة بيتعرض في «محتاج قرار» ومابيتكتبش — الصفر قرار، وغياب الصف سؤال.
"""
from __future__ import annotations

import sys
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.lib.item_points import classify
from src.models.catalog import Item
from src.models.loyalty import ProductPointValue


def _audit(items: list[Item], existing: dict[int, ProductPointValue]) -> None:
    """يقيس المحرك على قيم العميل: كام كارت يتفق، وكام يختلف وبكام."""
    same = diff = silent = 0
    rows: list[tuple[Decimal, Decimal, str, str]] = []
    for item in items:
        row = existing.get(item.id)
        if row is None:
            continue
        verdict = classify(item.name, item.category)
        if verdict.sale_points is None:
            silent += 1
            continue
        old = Decimal(str(row.point_value))
        if verdict.sale_points == old:
            same += 1
        else:
            diff += 1
            rows.append((old, verdict.sale_points, verdict.rule, item.name))

    total = same + diff
    print("=" * 56)
    print("قياس المحرك على الكروت اللي العميل حاططها بإيده")
    print("=" * 56)
    print(f"{'كروت عليها قيمة':<34}{len(existing):>8}")
    print(f"{'  اتفق':<34}{same:>8}")
    print(f"{'  اختلف':<34}{diff:>8}")
    print(f"{'  المحرك مالوش رأى':<34}{silent:>8}")
    if total:
        print(f"{'نسبة التطابق':<34}{same * 100.0 / total:>7.1f}%")
    for old, new, rule, name in sorted(rows):
        print(f"  العميل={old!s:<9} المحرك={new!s:<9} {rule:<24} {name}")


def run(*, execute: bool, overwrite: bool, audit: bool) -> None:
    db = SessionLocal()
    try:
        items = db.scalars(select(Item).order_by(Item.id)).all()
        existing = {p.item_id: p for p in db.scalars(select(ProductPointValue)).all()}

        if audit:
            _audit(items, existing)
            return

        priced: list[tuple[Item, Decimal, str]] = []
        zeroed = 0
        kept = 0
        undecided: dict[str, list[Item]] = defaultdict(list)
        written = updated = unchanged = 0

        for item in items:
            verdict = classify(item.name, item.category)
            if verdict.sale_points is None:
                undecided[verdict.rule].append(item)
                continue

            row = existing.get(item.id)
            if row is not None and not overwrite:
                kept += 1
                continue

            if verdict.sale_points == 0:
                zeroed += 1
            else:
                priced.append((item, verdict.sale_points, verdict.rule))

            if row is None:
                db.add(ProductPointValue(item_id=item.id, point_value=verdict.sale_points))
                written += 1
            elif Decimal(str(row.point_value)) != verdict.sale_points:
                row.point_value = verdict.sale_points
                updated += 1
            else:
                unchanged += 1

        print("=" * 56)
        print(f"{'كروت الكتالوج':<34}{len(items):>8}")
        print(f"{'عليها قيمة العميل — اتسابت':<34}{kept:>8}")
        print("-" * 56)
        print(f"{'هتاخد قيمة':<34}{len(priced):>8}")
        print(f"{'هتاخد صفر بالقصد':<34}{zeroed:>8}")
        print(f"{'محتاج قرار — مش هتتكتب':<34}{sum(len(v) for v in undecided.values()):>8}")
        print("-" * 56)
        print(f"{'  صف جديد':<34}{written:>8}")
        print(f"{'  اتعدّل':<34}{updated:>8}")
        print(f"{'  زي ما هو':<34}{unchanged:>8}")

        by_rule: dict[str, list[tuple[Item, Decimal]]] = defaultdict(list)
        for item, points, rule in priced:
            by_rule[rule].append((item, points))
        print()
        print("=" * 56)
        print("القواعد اللى اشتغلت")
        print("=" * 56)
        for rule in sorted(by_rule):
            hits = by_rule[rule]
            print(f"{rule:<28}{hits[0][1]:>9}  ×{len(hits):<4} مثال: {hits[0][0].name}")

        if undecided:
            print()
            print("=" * 56)
            print("محتاج قرار من العميل — مافيش نقط هتتكتب ليها")
            print("=" * 56)
            for reason, group in sorted(undecided.items(), key=lambda kv: -len(kv[1])):
                print(f"\n— {reason}  ({len(group)})")
                for item in group[:25]:
                    print(f"   #{item.id} {item.name}   [{item.category or '—'}]")
                if len(group) > 25:
                    print(f"   … و{len(group) - 25} غيرهم")

        if not execute:
            print("\n[عرض فقط] مافيش حاجة اتحفظت. ضيف --yes للتنفيذ.")
            return

        db.commit()
        print("\n✔ اتحفظت قيم النقاط.")
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    run(execute="--yes" in args, overwrite="--overwrite" in args, audit="--audit" in args)
