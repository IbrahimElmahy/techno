# -*- coding: utf-8 -*-
"""توحيد نوع حركة إذن التحويل — `transfer` بيبقى `stock_transfer`.

كان اسمين لنفس الحاجة: الخدمة بتكتب `"transfer"` ونقل a5 كتب `"stock_transfer"`.
والإلغاء والحذف بيدوّروا على `"transfer"` بس، فإلغاء أي إذن منقول من a5 كان **بينجح
من غير ما يرجّع بضاعة** — الحالة تبقى «ملغي» والحركات مكانها.

الاسم الموحّد هو اسم الجدول (`stock_transfer`) لأنه اللي الداتا عليه: ٦٤٬٥٩٨ حركة
مقابل ٤٦. والخدمة اتغيّرت الأول (`MOVEMENT_DOC`) وبعدين بيتنضّف اللي اتكتب قبل كده.

مافيش غير النوع بيتغيّر، والسكريبت بيتأكد بنفسه: بيقيس الرصيد لكل (صنف × مكان) قبل
وبعد وبيعمل rollback لو اتغيّر أي رقم.

    python -m src.scripts.normalize_transfer_doc_type            # عرض بس
    python -m src.scripts.normalize_transfer_doc_type --apply    # بيكتب
"""
from __future__ import annotations

import argparse

from sqlalchemy import case, func, select, update
from sqlalchemy.orm import Session

from src.core.db import SessionLocal
from src.models.stock import StockDirection, StockMovement
from src.services.transfer_service import MOVEMENT_DOC

OLD = "transfer"


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


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    db: Session = SessionLocal()
    try:
        for name, docs, moves in db.execute(
            select(StockMovement.source_doc_type,
                   func.count(func.distinct(StockMovement.source_doc_id)),
                   func.count(StockMovement.id))
            .where(StockMovement.source_doc_type.in_([OLD, MOVEMENT_DOC]))
            .group_by(StockMovement.source_doc_type)
        ).all():
            print(f"   {name:<18} أذون {docs:>5}  حركات {moves:>7}")

        n = db.scalar(select(func.count(StockMovement.id))
                      .where(StockMovement.source_doc_type == OLD))
        if not n:
            print()
            print(f"كله «{MOVEMENT_DOC}» خلاص.")
            return
        print()
        print(f"هيتغيّر: {n} حركة «{OLD}» ← «{MOVEMENT_DOC}»")

        if not args.apply:
            print()
            print("عرض بس — للكتابة زوّد --apply")
            return

        before = _balances(db)
        changed = db.execute(
            update(StockMovement)
            .where(StockMovement.source_doc_type == OLD)
            .values(source_doc_type=MOVEMENT_DOC)
        ).rowcount or 0
        db.flush()
        after = _balances(db)
        if before != after:
            db.rollback()
            diff = [k for k in set(before) | set(after) if before.get(k) != after.get(k)]
            raise SystemExit(f"اترفض: الرصيد اتغيّر في {len(diff)} (صنف × مكان)")
        db.commit()
        print(f"اتغيّر: {changed} حركة")
        print("الرصيد لكل صنف × مكان: زي ما هو بالظبط ✔")
    finally:
        db.close()


if __name__ == "__main__":
    main()
