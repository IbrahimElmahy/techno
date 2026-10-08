# -*- coding: utf-8 -*-
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
    rows = db.execute(
        select(StockMovement.movement_type, StockMovement.direction, func.count())
        .group_by(StockMovement.movement_type, StockMovement.direction)
    ).all()
    out: list[tuple[str, str | None, str, int]] = []
    for name, direction, n in rows:
        if name is None:
            continue
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
