# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse

from sqlalchemy import case, func, select, update
from sqlalchemy.orm import Session

from src.core.db import SessionLocal
from src.models.stock import StockDirection, StockDoc, StockMovement

RENAMES = {
    "sale": StockDoc.SALE,
    "sale_return": StockDoc.SALE_RETURN,
    "purchase": StockDoc.PURCHASE,
    "transfer": StockDoc.TRANSFER,
}


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
        counts = dict(db.execute(
            select(StockMovement.source_doc_type, func.count(StockMovement.id))
            .group_by(StockMovement.source_doc_type)
        ).all())

        print(f"{'الاسم القديم':<20} {'حركات':>7}   {'←':^3} {'الاسم الموحّد':<20} {'عنده':>7}")
        todo = {}
        for old, new in RENAMES.items():
            n = counts.get(old, 0)
            print(f"{old:<20} {n:>7}   {'←':^3} {new:<20} {counts.get(new, 0):>7}")
            if n:
                todo[old] = new
        if not todo:
            print()
            print("مافيش حاجة تتغيّر — كله موحّد خلاص.")
            return

        total = sum(counts.get(o, 0) for o in todo)
        print()
        print(f"هيتغيّر: {total} حركة")
        if not args.apply:
            print()
            print("عرض بس — للكتابة زوّد --apply")
            return

        before = _balances(db)
        changed = 0
        for old, new in todo.items():
            changed += db.execute(
                update(StockMovement)
                .where(StockMovement.source_doc_type == old)
                .values(source_doc_type=new)
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
        for name, n in db.execute(
            select(StockMovement.source_doc_type, func.count(StockMovement.id))
            .group_by(StockMovement.source_doc_type)
            .order_by(func.count(StockMovement.id).desc())
        ).all():
            print(f"   {name:<20} {n:>7}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
