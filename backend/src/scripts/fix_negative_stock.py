# -*- coding: utf-8 -*-
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
