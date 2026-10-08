from __future__ import annotations

import sys
from decimal import Decimal

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.catalog import Item

PCT = Decimal("10")

CATEGORIES: list[tuple[str, int]] = [
    ("تكنو ثيرم", 277),
    ("تكنو جوان", 228),
    ("ابيض تكنوو", 118),
    ("تكنو ثيرم معزول", 95),
    ("ابيض تكنوو 110", 65),
]


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        print(f"{'الفئة':<24}{'أصناف':>7}{'المتوقع':>9}{'خصمها دلوقتي':>26}")
        print("-" * 68)
        plan: list[Item] = []
        warn: list[str] = []
        for cat, expected in CATEGORIES:
            items = db.scalars(select(Item).where(Item.category == cat)).all()
            spread = db.execute(
                select(Item.default_discount_pct, func.count())
                .where(Item.category == cat)
                .group_by(Item.default_discount_pct)
                .order_by(func.count().desc())).all()
            txt = "، ".join(f"{float(d or 0):g}%×{n}" for d, n in spread) or "—"
            print(f"{cat[:22]:<24}{len(items):>7}{expected:>9}   {txt}")
            if len(items) != expected:
                warn.append(f"«{cat}»: {len(items)} صنف والمقاس كان {expected}")
            plan += [i for i in items
                     if Decimal(str(i.default_discount_pct or 0)) != PCT]

        print(f"\nهيتغيّر خصمها الثابت لـ{PCT:g}٪: {len(plan)} صنف")

        others = db.scalar(
            select(func.count()).select_from(Item)
            .where(Item.default_discount_pct != 0,
                   Item.category.notin_([c for c, _n in CATEGORIES]))) or 0
        print(f"أصناف برّه الفئات دي وعليها خصم ثابت (مش هتتلمس): {others}")

        if warn:
            print("\n⚠️ العدد مش زي المقاس — راجع قبل التنفيذ:")
            for w in warn:
                print(f"   {w}")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for i in plan:
            i.default_discount_pct = PCT
        db.commit()

        print("\nبعد التنفيذ:")
        for cat, _e in CATEGORIES:
            n = db.scalar(select(func.count()).select_from(Item)
                          .where(Item.category == cat,
                                 Item.default_discount_pct == PCT)) or 0
            t = db.scalar(select(func.count()).select_from(Item)
                          .where(Item.category == cat)) or 0
            print(f"   {'✔' if n == t else '✘'} {cat[:22]:<24}{n}/{t} على {PCT:g}٪")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
