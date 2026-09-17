# -*- coding: utf-8 -*-
"""الرصيد السالب — الرصيد الافتتاحي اللي نقل a5 مانقلوش.

«فحص النظام» بيقول **١١ رصيد سالب**، وبيقول الجملة الصح: الصنف طلع من مكان مكانش
فيه، فالتكلفة والجرد والمتاح كلهم بيتحسبوا على كمية مش موجودة.

## السبب اتحدّد، مش اتخمّن

نقل a5 نقل الأرصدة الافتتاحية **ناقصة**: كل مخزن خد افتتاحي لجزء من أصنافه بس.

    مخزن سياره 2   ٩٤ صنف بافتتاحي  —  ٢٩٩ صنف ليها حركة
    مخزن سياره 1   ٩١ صنف بافتتاحي  —  ٢٧٠ صنف ليها حركة
    المخزن الرئيسى ٣٩١ صنف بافتتاحي  —  ٥٠٣ صنف ليها حركة

يعني مئات الأصناف بتتاجر من غير ما حد يقول إنها كانت موجودة أصلاً. والأحد عشر
السالبين هم اللي النقص فيهم كان أكبر من اللي دخل بعد كده، فطلعوا تحت الصفر. الباقي
نفس النقص بالظبط — بس الرصيد ستره.

وده **مش** تحويل ضايع من المخزن الرئيسي: افتتاحي المخزن الرئيسي اتنقل من a5 زي ما
هو، فخصم الكمية منه هيبقى خصم مرتين. النقص في الفان، والتصليح في الفان.

## الكمية اللي بتتكتب

**أقل كمية المستندات بتثبتها، ولا حبة زيادة.** الفان اللي رصيده `-72` باع ٧٢ أكتر
مما استلم، فافتتاحيه كان ٧٢ على الأقل. غالباً كان أكتر — كان معاه بضاعة لسه ماباعهاش
— بس الرقم ده مافيش مستند بيقوله، والتخمين فيه بيزوّد مخزون مش موجود.

فالتصليح **مابيرفعش رصيد فوق الصفر أبداً**: بيوصّله لصفر بالظبط. اللي بعد كده جردة.

## الحركة اللي بتتكتب

نفس شكل الافتتاحي اللي النقل كتبه — `movement_type='opening'` — وبتاريخ أقدم من أي
حركة في النظام، عشان الرصيد **التاريخي** مايبقاش سالب كمان: تقرير جرد بتاريخ قديم
لازم يطلع صح زي تقرير النهارده.

و`source_doc_type='a5_opening_fix'` بيفرّقها عن الافتتاحي الأصلي، فاللي يبص بعدين
يعرف الرقم ده جه منين وإنه استنتاج من النقص مش نقل من a5.

    python -m src.scripts.fix_negative_stock            # عرض بس
    python -m src.scripts.fix_negative_stock --apply    # بيكتب
"""
from __future__ import annotations

import argparse
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from src.core.db import SessionLocal
from src.core.money import to_qty
from src.models.catalog import Item
from src.models.stock import LocationKind, StockDirection, StockMovement
from src.models.warehouse import Warehouse

ZERO = Decimal("0")
SOURCE = "a5_opening_fix"


def negatives(db: Session) -> list[tuple[int, int, Decimal]]:
    """(صنف، مخزن، الرصيد السالب) — استعلام واحد على كل الحركات."""
    signed = func.sum(case(
        (StockMovement.direction == StockDirection.in_, StockMovement.quantity),
        else_=-StockMovement.quantity,
    ))
    rows = db.execute(
        select(StockMovement.item_id, StockMovement.location_id, signed)
        .where(StockMovement.location_kind == LocationKind.warehouse)
        .group_by(StockMovement.item_id, StockMovement.location_id)
        .having(signed < 0)
        .order_by(signed)
    ).all()
    return [(iid, lid, to_qty(bal)) for iid, lid, bal in rows]


def _opening_moment(db: Session):
    """قبل أقدم حركة في النظام بثانية.

    الافتتاحي لازم يسبق كل حاجة، مش يتحط النهارده: لو اتحط بتاريخ اليوم يبقى الرصيد
    في أي تقرير بتاريخ قديم لسه سالب، والفحص هيسكت بينما التقرير لسه بيكدب.
    """
    first = db.scalar(select(func.min(StockMovement.created_at)))
    return first - timedelta(seconds=1)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true", help="اكتب فعلاً")
    ap.add_argument("--actor", type=int, default=1, help="المستخدم اللي الحركة تتكتب باسمه")
    args = ap.parse_args()

    db: Session = SessionLocal()
    try:
        bad = negatives(db)
        if not bad:
            print("مافيش رصيد سالب.")
            return

        items = {i.id: f"{i.code} — {i.name}" for i in db.scalars(
            select(Item).where(Item.id.in_([i for i, _, _ in bad]))).all()}
        whs = {w.id: (w.name, w.branch_id) for w in db.scalars(
            select(Warehouse).where(Warehouse.id.in_([l for _, l, _ in bad]))).all()}
        moment = _opening_moment(db)

        print(f"رصيد سالب: {len(bad)} حالة | الافتتاحي هيتكتب بتاريخ {moment}")
        print()
        print(f"{'الصنف':<34} {'المخزن':<22} {'الرصيد':>10} {'افتتاحي':>10} {'بعده':>8}")
        total = ZERO
        for item_id, wh_id, bal in bad:
            need = -bal
            total += need
            name, _ = whs.get(wh_id, (f"#{wh_id}", None))
            print(f"{items.get(item_id, f'#{item_id}')[:34]:<34} {str(name)[:22]:<22} "
                  f"{bal!s:>10} {need!s:>10} {'0.000':>8}")
        print()
        print(f"إجمالي الكمية اللي هتتكتب: {to_qty(total)}")

        if not args.apply:
            print()
            print("عرض بس — للكتابة زوّد --apply")
            return

        for item_id, wh_id, bal in bad:
            _, branch_id = whs.get(wh_id, (None, None))
            db.add(StockMovement(
                item_id=item_id,
                location_kind=LocationKind.warehouse,
                location_id=wh_id,
                movement_type="opening",
                direction=StockDirection.in_,
                quantity=-bal,
                source_doc_type=SOURCE,
                source_doc_id=0,
                actor_user_id=args.actor,
                created_at=moment,
                branch_id=branch_id,
            ))
        db.commit()
        print()
        print(f"اتكتب: {len(bad)} حركة افتتاحي")
        left = negatives(db)
        print(f"الباقي سالب: {len(left)}")
        for item_id, wh_id, bal in left:
            print(f"  ! {items.get(item_id, item_id)} في {whs.get(wh_id, wh_id)} = {bal}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
