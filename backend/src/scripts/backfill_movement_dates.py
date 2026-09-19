"""يملا `stock_movement.movement_date` من تاريخ المستند اللي الحركة جاية منه.

    python -m src.scripts.backfill_movement_dates            # عرض بس
    python -m src.scripts.backfill_movement_dates --yes
    python -m src.scripts.backfill_movement_dates --yes --batch 20000

**ليه:** الحركة ما كانتش شايلة تاريخ — `created_at` وحده، يعني وقت كتابة الصف عندنا.
النقل من a5 كتب حركة الشركة كلها في يوم واحد، فالنتيجة:

* كارت الصنف بيقول إن بيع يناير حصل يوم النقل.
* الجرد بأي تاريخ قبل يوم النقل بيرجع **مخزن فاضي**، والبضاعة كلها بتظهر مرة واحدة.
* الفاتورة اللي تتكتب النهارده بتاريخ قديم، حركتها تتسجّل بتاريخ النهارده.

السكربت بيمشي على الحركات اللي `movement_date` بتاعها فاضي، بيجيب تاريخ ورقتها من
`stock_docs.date_of`، وبيكتبه.

**والرصيد الافتتاحي ماياخدش يوم النقل.** لو أخده، يبقى البيع بتاريخ يناير حصل قبل ما
البضاعة تدخل المخزن أصلاً — والرصيد الجاري في كارت الصنف بينزل سالب لحد سبتمبر. الصح
إنه أول السنة اللي فيها أقدم مستند: ده معنى «أول المدة» عند a5 نفسه (`AznType = 0`).

وباقي اللي مالوش ورقة مؤرَّخة — الهالك والكوبون وأرقام التسلسل — بياخد `created_at`
بتاعه: أحسن تقدير موجود، وأصدق من إنه يفضل فاضي فيختفي من أي جرد بتاريخ.

**بيتعاد تشغيله بأمان.** بيشتغل على الفاضي بس، فالتشغيلة التانية مابتلمسش اللي اتكتب.
وبيكتب على دفعات ويعمل commit لكل دفعة عشان جدول بمليون صف مايقفلش المعاملة ساعة.
"""
from __future__ import annotations

import argparse
import sys
from collections import Counter

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.lib import stock_docs
from src.models.stock import StockDoc, StockMovement

#: الحركات اللي بتوصف رصيد أول المدة — مالهاش ورقة، وتاريخها أول السنة مش يوم النقل.
_OPENING = {StockDoc.OPENING, StockDoc.OPENING_FIX, "opening"}


def _opening_day(db):
    """أول يناير من سنة أقدم مستند — التاريخ اللي «أول المدة» بيسبق كل حاجة فيه."""
    from datetime import date as _date

    earliest = None
    for mv in db.scalars(
        select(StockMovement)
        .where(StockMovement.source_doc_type.not_in(list(_OPENING)))
        .order_by(StockMovement.id)
        .limit(20000)
    ).all():
        day = stock_docs.date_of(db, mv.source_doc_type, mv.source_doc_id)
        if day and (earliest is None or day < earliest):
            earliest = day
    return _date(earliest.year, 1, 1) if earliest else None


def run(*, execute: bool, batch: int) -> int:
    db = SessionLocal()
    try:
        total = db.scalar(select(func.count(StockMovement.id))) or 0
        blank = db.scalar(
            select(func.count(StockMovement.id))
            .where(StockMovement.movement_date.is_(None))
        ) or 0
        print(f"{'إجمالي الحركات':<26}{total:,}")
        print(f"{'من غير تاريخ':<26}{blank:,}")
        if not blank:
            print("\nمافيش حاجة تتعمل.")
            return 0

        if not execute:
            # عيّنة بس — الفكرة إن اللي بيشغّل يشوف الفرق قبل ما يوافق عليه.
            sample = db.scalars(
                select(StockMovement)
                .where(StockMovement.movement_date.is_(None))
                .order_by(StockMovement.id)
                .limit(10)
            ).all()
            print("\nعيّنة:")
            for mv in sample:
                doc = stock_docs.date_of(db, mv.source_doc_type, mv.source_doc_id)
                print(f"   #{mv.id:<10}{(mv.source_doc_type or '-'):<18}"
                      f"مكتوب {mv.created_at:%Y-%m-%d}  ←  "
                      f"{doc if doc else 'مالوش ورقة مؤرَّخة — هياخد يوم كتابته'}")
            print("\n[عرض فقط] مافيش حاجة اتحفظت. ضيف --yes للتنفيذ.")
            return 0

        opening_day = _opening_day(db)
        print(f"{'تاريخ أول المدة':<26}{opening_day or 'مش معروف — هياخد يوم الكتابة'}")

        done = 0
        moved = 0                      # اتاخد من ورقته
        opened = 0                     # رصيد أول المدة
        fallback = 0                   # مالوش ورقة — أخد يوم كتابته
        kinds: Counter[str] = Counter()
        while True:
            rows = db.scalars(
                select(StockMovement)
                .where(StockMovement.movement_date.is_(None))
                .order_by(StockMovement.id)
                .limit(batch)
            ).all()
            if not rows:
                break
            for mv in rows:
                doc_day = stock_docs.date_of(db, mv.source_doc_type, mv.source_doc_id)
                if doc_day is not None:
                    mv.movement_date = doc_day
                    moved += 1
                    if mv.created_at and doc_day != mv.created_at.date():
                        kinds[mv.source_doc_type or "-"] += 1
                elif mv.source_doc_type in _OPENING and opening_day is not None:
                    mv.movement_date = opening_day
                    opened += 1
                else:
                    mv.movement_date = mv.created_at.date() if mv.created_at else None
                    fallback += 1
            db.commit()
            done += len(rows)
            print(f"   ... {done:,} / {blank:,}")

        print(f"\n{'اتعبّى من ورقته':<26}{moved:,}")
        print(f"{'رصيد أول المدة':<26}{opened:,}")
        print(f"{'أخد يوم كتابته':<26}{fallback:,}")
        if kinds:
            print("\nاللي تاريخه اتغيّر فعلاً:")
            for name, n in kinds.most_common():
                print(f"   {name:<22}{n:,}")
        return 0
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="يملا تاريخ حركة المخزون من مستندها")
    ap.add_argument("--yes", action="store_true", help="نفّذ فعلاً")
    ap.add_argument("--batch", type=int, default=10000, help="حجم الدفعة")
    args = ap.parse_args()
    sys.exit(run(execute=args.yes, batch=args.batch))


if __name__ == "__main__":
    main()
