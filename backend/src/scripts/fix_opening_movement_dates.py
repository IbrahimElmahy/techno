from __future__ import annotations

import argparse
from datetime import date, datetime

from sqlalchemy import case, func, select, update

from src.core.db import SessionLocal
from src.models.org import Branch
from src.models.stock import LocationKind, StockMovement
from src.services.costing_service import OPENING_DOCS, movement_day, signed_quantity


def _month_ends(year: int) -> list[date]:
    out = []
    for m in range(1, 13):
        nxt = date(year + (m == 12), m % 12 + 1, 1)
        out.append(date.fromordinal(nxt.toordinal() - 1))
    return out


def _negatives(db, *, opening_day: date | None, ends: list[date]) -> dict[tuple, int]:
    day = movement_day()
    if opening_day is not None:
        day = case((StockMovement.source_doc_type.in_(OPENING_DOCS), opening_day), else_=day)
    cols = [func.sum(case((day <= d, signed_quantity()), else_=0)).label(f"q{k}")
            for k, d in enumerate(ends)]
    inner = (select(StockMovement.branch_id, StockMovement.item_id, StockMovement.location_id,
                    *cols)
             .where(StockMovement.location_kind == LocationKind.warehouse)
             .group_by(StockMovement.branch_id, StockMovement.item_id,
                       StockMovement.location_id)).subquery()
    stmt = select(inner.c.branch_id, *[func.sum(case((inner.c[f"q{k}"] < 0, 1), else_=0))
                                       for k in range(len(ends))]).group_by(inner.c.branch_id)
    out = {}
    for branch_id, *counts in db.execute(stmt).all():
        for d, n in zip(ends, counts, strict=True):
            out[(branch_id, d)] = int(n or 0)
    return out


def run(*, opening_day: date, execute: bool) -> None:
    db = SessionLocal()
    try:
        names = dict(db.execute(select(Branch.id, Branch.name)).all())
        day = movement_day()
        rows = db.execute(
            select(StockMovement.branch_id, StockMovement.source_doc_type, day,
                   func.count(), func.sum(case((day != opening_day, 1), else_=0)))
            .where(StockMovement.source_doc_type.in_(OPENING_DOCS))
            .group_by(StockMovement.branch_id, StockMovement.source_doc_type, day)
            .order_by(StockMovement.branch_id, StockMovement.source_doc_type, day)).all()

        print(f"تاريخ رصيد أول المدة الصحيح: {opening_day.isoformat()}\n")
        print(f"{'الفرع':<12}{'النوع':<18}{'التاريخ الحالي':<16}{'حركات':>8}{'هتتغير':>8}")
        print("-" * 62)
        change = {}
        for branch_id, doc, d, n, wrong in rows:
            print(f"{names.get(branch_id, '—'):<12}{doc:<18}{str(d):<16}{n:>8,}{int(wrong):>8,}")
            change[branch_id] = change.get(branch_id, 0) + int(wrong)
        print("-" * 62)
        for branch_id, n in change.items():
            print(f"{names.get(branch_id, '—'):<12}هتتغير {n:,} حركة")
        total = sum(change.values())

        ends = [d for d in _month_ends(opening_day.year + 1) if d <= date.today()]
        before = _negatives(db, opening_day=None, ends=ends)
        after = _negatives(db, opening_day=opening_day, ends=ends)
        print("\nصفوف رصيد سالب (صنف × مخزن) في آخر كل شهر — قبل ← بعد:")
        print(f"{'الشهر':<10}" + "".join(f"{names.get(b, '—'):>18}" for b in sorted(names)))
        for d in ends:
            cells = "".join(f"{before.get((b, d), 0):>9,} ← {after.get((b, d), 0):<6,}"
                            for b in sorted(names))
            print(f"{d.strftime('%Y-%m'):<10}{cells}")

        if not execute:
            print(f"\nعرض فقط — {total:,} حركة هتتغير. أضف --yes للتنفيذ.")
            return
        result = db.execute(
            update(StockMovement)
            .where(StockMovement.source_doc_type.in_(OPENING_DOCS),
                   (StockMovement.movement_date.is_(None))
                   | (StockMovement.movement_date != opening_day))
            .values(movement_date=opening_day))
        db.commit()
        print(f"\nتم: {result.rowcount:,} حركة بقى تاريخها {opening_day.isoformat()}.")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="تاريخ حركات رصيد أول المدة = يوم قبل بداية السنة")
    ap.add_argument("--date", default="2025-12-31")
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args()
    run(opening_day=datetime.strptime(a.date, "%Y-%m-%d").date(), execute=a.yes)


if __name__ == "__main__":
    main()
