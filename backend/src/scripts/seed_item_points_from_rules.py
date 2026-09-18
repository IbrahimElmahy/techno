"""يملا `product_point_value` من جدول قواعد العميل («حساب نقاط») مش من قايمة أسماء.

    python -m src.scripts.seed_item_points_from_rules
    python -m src.scripts.seed_item_points_from_rules --yes

بيقرا تصنيف الكارت واسمه، ويطلّع منهم العيلة والنوع والمقاس، ويدوّر على القاعدة في
`src/lib/item_points.py`. الافتراضي عرض بس — `--yes` هي اللي بتكتب.

**الكارت اللي مالوش قاعدة مابياخدش صفر.** بيتعرض في قايمة «محتاج قرار» ومابيتكتبش
خالص، فـ`product_point_value` بيفضل فاضي عنده والكسب بيبقى صفر — وده مقصود: الصفر
المكتوب بيبان إنه قرار، والصف الناقص بيفضل سؤال مفتوح لحد ما العميل يجاوب. لو
كتبناهم صفر دلوقتي مافيش شاشة هتفرّق بين الاتنين تاني.

Idempotent: بيعدّل الصف الموجود مابيضيفش تاني.
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


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        items = db.scalars(select(Item).order_by(Item.id)).all()
        existing = {p.item_id: p for p in db.scalars(select(ProductPointValue)).all()}

        priced: list[tuple[Item, Decimal, str]] = []
        zeroed: list[Item] = []
        undecided: dict[str, list[Item]] = defaultdict(list)

        written = updated = unchanged = 0

        for item in items:
            verdict = classify(item.name, item.category)
            if verdict.points is None:
                undecided[verdict.rule].append(item)
                continue
            if verdict.points == 0:
                zeroed.append(item)
            else:
                priced.append((item, verdict.points, verdict.rule))

            row = existing.get(item.id)
            if row is None:
                db.add(ProductPointValue(item_id=item.id, point_value=verdict.points))
                written += 1
            elif Decimal(str(row.point_value)) != verdict.points:
                row.point_value = verdict.points
                updated += 1
            else:
                unchanged += 1

        print("=" * 56)
        print(f"{'كروت الكتالوج':<34}{len(items):>8}")
        print("-" * 56)
        print(f"{'خدت قيمة نقطة':<34}{len(priced):>8}")
        print(f"{'اتكتبت صفر بالقصد':<34}{len(zeroed):>8}")
        print(f"{'محتاج قرار — مااتكتبتش':<34}{sum(len(v) for v in undecided.values()):>8}")
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
            print(f"{rule:<28}{hits[0][1]:>8}  ×{len(hits):<4} مثال: {hits[0][0].name}")

        if undecided:
            print()
            print("=" * 56)
            print("محتاج قرار من العميل — مافيش نقط اتكتبت ليها")
            print("=" * 56)
            for reason, group in sorted(undecided.items(), key=lambda kv: -len(kv[1])):
                print(f"\n— {reason}  ({len(group)})")
                for item in group:
                    print(f"   #{item.id} {item.name}   [{item.category or '—'}]")

        if not execute:
            print("\n[عرض فقط] مافيش حاجة اتحفظت. ضيف --yes للتنفيذ.")
            return

        db.commit()
        print("\n✔ اتحفظت قيم النقاط.")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
