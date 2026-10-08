from __future__ import annotations

import sys
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.loyalty import PURSE_BY_KIND, PointPurse, PointRecord
from src.services import points_service


def _snapshot(db) -> dict[tuple[int, str], Decimal]:
    out: dict[tuple[int, str], Decimal] = {}
    for purse in (PointPurse.inspection, PointPurse.coupon):
        for cid, total in points_service.balances(db, purse=purse).items():
            out[(cid, purse.value)] = total
    return out


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        before = _snapshot(db)
        rows = db.scalars(select(PointRecord).where(PointRecord.purse.is_(None))).all()
        print(f"سطور من غير جيب: {len(rows)}")
        if not rows:
            print("مافيش حاجة تتعمل.")
            return

        counts: dict[str, int] = {}
        for record in rows:
            kind = record.kind.value if hasattr(record.kind, "value") else str(record.kind)
            purse = PURSE_BY_KIND.get(kind, PointPurse.both)
            record.purse = purse
            counts[purse.value] = counts.get(purse.value, 0) + 1

        for purse, count in sorted(counts.items()):
            print(f"  {purse:<12}{count:>8}")

        db.flush()
        after = _snapshot(db)
        moved = {k: (before.get(k, Decimal('0')), v)
                 for k, v in after.items() if before.get(k, Decimal("0")) != v}
        moved.update({k: (v, after.get(k, Decimal('0')))
                      for k, v in before.items() if after.get(k, Decimal("0")) != v})
        if moved:
            db.rollback()
            print(f"\n✗ الأرصدة اتغيّرت في {len(moved)} حالة — اترجع كل حاجة ومافيش حاجة اتحفظت.")
            for (cid, purse), (was, now) in list(moved.items())[:20]:
                print(f"   عميل {cid} · {purse}: {was} ⇐ {now}")
            return

        print("\n✔ الأرصدة زي ما هي بالظبط في الجيبين.")
        if not execute:
            db.rollback()
            print("[عرض فقط] مافيش حاجة اتحفظت. ضيف --yes للتنفيذ.")
            return
        db.commit()
        print("✔ اتحفظ الجيب على السطور القديمة.")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
