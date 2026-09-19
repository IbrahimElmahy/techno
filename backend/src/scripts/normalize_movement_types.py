# -*- coding: utf-8 -*-
"""توحيد `stock_movement.movement_type` على السجل — الشق التاني من نفس التوحيد.

`normalize_stock_doc_types` وحّد **الورقة** (`source_doc_type`). ده بيوحّد **نوع
الحركة**، اللي فضل بأسمين لنفس الحاجة:

    sale          45,555  ←  sale_out          115
    purchase       3,861  ←  purchase_in         9
    sales_return   1,908  ←  sale_return_in      2
    permit_in/out          ←  permit            363   (الاتجاه هو اللي بيفرّق)

والغلط اللي ده بيسبّبه ظاهر في كارت الصنف: فلتر «نوع الحركة» بيقارن النص حرفياً،
فاختيار «بيع» كان بيرجع ١١٥ سطر أو ٤٥٬٥٥٥ على حسب أي اسم اتخزّن. الشرح الكامل في
`src/lib/stock_docs.py`.

**`permit` بيتفكّ بالاتجاه.** ٣٦٣ حركة اسمها `permit` من غير ما تقول إضافة ولا صرف،
والصف نفسه عارف: `direction=in` ⇒ `permit_in`، و`out` ⇒ `permit_out`. ده استنتاج من
داتا موجودة مش تخمين.

مافيش غير الاسم بيتغيّر — لا كمية ولا اتجاه ولا صنف ولا مكان — فالرصيد مايتحركش،
والسكربت بيتأكد بنفسه: بيقيس الرصيد لكل (صنف × مكان) قبل وبعد وبيعمل rollback لو
اتغيّر أي رقم.

    python -m src.scripts.normalize_movement_types            # عرض بس
    python -m src.scripts.normalize_movement_types --apply    # بيكتب
"""
from __future__ import annotations

import argparse

from sqlalchemy import case, func, select, update
from sqlalchemy.orm import Session

from src.core.db import SessionLocal
from src.lib import stock_docs
from src.models.stock import StockDirection, StockMovement


def _balances(db: Session) -> dict[tuple[int, str, int], object]:
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


def _plan(db: Session) -> list[tuple[str, str | None, str, int]]:
    """(الاسم القديم، الاتجاه لو بيفرّق، الاسم الجديد، العدد)."""
    rows = db.execute(
        select(StockMovement.movement_type, StockMovement.direction, func.count())
        .group_by(StockMovement.movement_type, StockMovement.direction)
    ).all()
    out: list[tuple[str, str | None, str, int]] = []
    for name, direction, n in rows:
        if name is None:
            continue
        # `permit` مش بيقول إضافة ولا صرف — الاتجاه بيقول.
        if name == "permit":
            out.append((name, getattr(direction, "value", direction),
                        "permit_in" if direction == StockDirection.in_ else "permit_out", n))
            continue
        new = stock_docs.canonical(name, kind="movement")
        if new is None:
            print(f"   ⚠ «{name}» مش في السجل — اتساب زي ما هو ({n:,} حركة)")
            continue
        if new != name:
            out.append((name, None, new, n))
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="توحيد أنواع حركة المخزون")
    ap.add_argument("--apply", action="store_true", help="نفّذ فعلاً")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        plan = _plan(db)
        if not plan:
            print("مافيش اسم قديم — كله موحّد خلاص.")
            return
        print(f"\n{'القديم':<24}{'الاتجاه':<10}{'الجديد':<24}العدد")
        for old, direction, new, n in plan:
            print(f"   {old:<21}{(direction or '-'):<10}{new:<24}{n:>8,}")
        total = sum(n for *_, n in plan)
        print(f"\n   الإجمالي {total:,} حركة")

        if not args.apply:
            print("\n[عرض فقط] مافيش حاجة اتحفظت. ضيف --apply للتنفيذ.")
            return

        before = _balances(db)
        for old, direction, new, _n in plan:
            stmt = update(StockMovement).where(StockMovement.movement_type == old)
            if direction is not None:
                stmt = stmt.where(StockMovement.direction == StockDirection(direction))
            db.execute(stmt.values(movement_type=new))
        db.flush()

        after = _balances(db)
        if before != after:
            db.rollback()
            changed = [k for k in set(before) | set(after) if before.get(k) != after.get(k)]
            raise SystemExit(
                f"الرصيد اتغيّر في {len(changed)} (صنف × مكان) — اترجع كل حاجة. "
                f"أول واحد: {changed[:1]}"
            )
        db.commit()
        print(f"\n   ✓ اتغيّر اسم {total:,} حركة، والرصيد زي ما هو في "
              f"{len(after):,} (صنف × مكان).")
    finally:
        db.close()


if __name__ == "__main__":
    main()
