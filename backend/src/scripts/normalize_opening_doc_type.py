# -*- coding: utf-8 -*-
"""توحيد نوع مستند الرصيد الافتتاحي — `a5_openingAL-` بيبقى `a5_opening`.

سكريبت النقل كان بيكتب `f"a5_opening{prefix}"`، والبادئة دي هي بادئة الشركة. فالرصيد
الافتتاحي اتقسّم على دلوين مالهمش معنى: `a5_opening` (٨٤١ حركة، أكتوبر) و
`a5_openingAL-` (١٤٦٧ حركة، العلياء). نفس الحاجة باسمين، وأي استعلام بيسأل عن
الافتتاحي لازم يفتكر التانية وإلا بيقرا نص التاريخ.

## الترتيب مهم

`import_a5_phase2` كان **بيستخدم الاسم ده كحارس تكرار**: بيدوّر على
`a5_opening{prefix}` وبيتخطى اللي لقاه. فلو الداتا اتغيّرت والسكريبت زي ما هو، تشغيلة
تانية للعلياء هتدوّر على `a5_openingAL-`، مش هتلاقي ولا حركة، و**تكتب الألف وأربعمية
حركة تاني** — يعني رصيد العلياء الافتتاحي يتضاعف.

عشان كده الحارس اتغيّر الأول (`OPENING_DOC` ثابت لكل الشركات) وبعدين بيتنضّف هنا.
والحارس بقى أقوى: بيقرا كل الافتتاحي مهما كان مين كتبه.

مافيش غير النوع بيتغيّر — لا كمية ولا اتجاه ولا تاريخ ولا صنف ولا مخزن — فالرصيد
والتقارير مابيتحركش فيهم حاجة. السكريبت بيتأكد من ده بنفسه: بيقيس الرصيد لكل
(صنف × مخزن) قبل وبعد، وبيرفض التثبيت لو اتغيّر أي رقم.

    python -m src.scripts.normalize_opening_doc_type            # عرض بس
    python -m src.scripts.normalize_opening_doc_type --apply    # بيكتب
"""
from __future__ import annotations

import argparse

from sqlalchemy import case, func, select, update
from sqlalchemy.orm import Session

from src.core.db import SessionLocal
from src.models.stock import StockDirection, StockMovement

TARGET = "a5_opening"


def _balances(db: Session) -> dict[tuple[int, str, int], object]:
    """الرصيد لكل (صنف × مكان) — البصمة اللي لازم ماتتغيّرش."""
    signed = func.sum(case(
        (StockMovement.direction == StockDirection.in_, StockMovement.quantity),
        else_=-StockMovement.quantity,
    ))
    return {
        (iid, getattr(kind, "value", kind), lid): qty
        for iid, kind, lid, qty in db.execute(
            select(StockMovement.item_id, StockMovement.location_kind,
                   StockMovement.location_id, signed)
            .group_by(StockMovement.item_id, StockMovement.location_kind,
                      StockMovement.location_id)
        ).all()
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true", help="اكتب فعلاً")
    args = ap.parse_args()

    db: Session = SessionLocal()
    try:
        counts = db.execute(
            select(StockMovement.source_doc_type, func.count(StockMovement.id))
            .where(StockMovement.source_doc_type.like("a5_opening%"))
            .group_by(StockMovement.source_doc_type)
            .order_by(func.count(StockMovement.id).desc())
        ).all()
        print("أنواع الافتتاحي الموجودة دلوقتي:")
        for name, n in counts:
            print(f"   {name:<20} {n:>6}")

        stray = [(name, n) for name, n in counts
                 if name != TARGET and not name.endswith("_fix")]
        if not stray:
            print()
            print(f"كله «{TARGET}» خلاص — مافيش حاجة تتعمل.")
            return

        total = sum(n for _, n in stray)
        print()
        print(f"هيتغيّر: {total} حركة ← «{TARGET}»")

        if not args.apply:
            print()
            print("عرض بس — للكتابة زوّد --apply")
            return

        before = _balances(db)
        changed = 0
        for name, _ in stray:
            changed += db.execute(
                update(StockMovement)
                .where(StockMovement.source_doc_type == name)
                .values(source_doc_type=TARGET)
            ).rowcount or 0
        db.flush()

        after = _balances(db)
        if before != after:
            db.rollback()
            diff = [k for k in set(before) | set(after) if before.get(k) != after.get(k)]
            raise SystemExit(
                f"اترفض: الرصيد اتغيّر في {len(diff)} (صنف × مكان) — أول واحد {diff[:1]}")

        db.commit()
        print(f"اتغيّر: {changed} حركة")
        print("الرصيد لكل صنف × مكان: زي ما هو بالظبط ✔")
        for name, n in db.execute(
            select(StockMovement.source_doc_type, func.count(StockMovement.id))
            .where(StockMovement.source_doc_type.like("a5_opening%"))
            .group_by(StockMovement.source_doc_type)
        ).all():
            print(f"   {name:<20} {n:>6}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
