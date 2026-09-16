# -*- coding: utf-8 -*-
"""تاريخ اعتماد أذون التحويل اللي اتكتب ثابت.

`transfer_service.approve` كان بيحط `datetime(2026, 1, 1)` والتعليق بيقول إن اللي
بينادي بيظبطه في الإنتاج — و`api/transfers.py` مابيلمسش الحقل. فكل إذن اتعتمد من
الشاشة من ساعة التشغيل مكتوب عليه إنه اتعتمد أول يناير. الكود اتصلّح؛ ده بيصلّح اللي
اتكتب قبله.

## التاريخ بيتقرا من الحركة نفسها

الاعتماد هو اللي بيكتب الحركات، فأقدم حركة على المستند هي لحظة اعتماده — مش تقدير،
ده الأثر اللي الاعتماد سابه. وبتطلع منطقية: TRF-000001 اتعمل 14:05:02 وأقدم حركة
14:06:02، يعني دقيقة بين الكتابة والاعتماد.

## والحركة اللي اتكتبت تاني مابتتصدّقش

الإذن اللي اتلغى ورجع (`restore_transfer`) حركاته اتكتبت من جديد، فتاريخها هو تاريخ
الرجوع مش الاعتماد الأصلي. فالسكريبت بيرفض أي مستند الفرق فيه بين إنشاءه وأقدم حركة
أكتر من يوم، وبيطلب القيمة صريحة بـ`--set`:

    --set 2504=2026-09-10T17:33:57

الرقم ده بيتقرا من نسخة احتياطية اتاخدت قبل الرجوع — أثر حقيقي برضه، بس من مكان تاني.

    python -m src.scripts.fix_transfer_approved_at
    python -m src.scripts.fix_transfer_approved_at --set 2504=2026-09-10T17:33:57 --apply
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.core.db import SessionLocal
from src.models.stock import StockMovement
from src.models.transfer import StockTransfer
from src.services import transfer_service

# التاريخ الثابت اللي الكود كان بيحطه.
STUCK = datetime(2026, 1, 1)
# فرق أكبر من كده بين إنشاء المستند وأقدم حركة معناه إن الحركة اتكتبت تاني.
SANE_GAP = timedelta(days=1)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--set", action="append", default=[], metavar="ID=ISO",
                    help="تاريخ صريح لمستند حركاته اتكتبت تاني")
    args = ap.parse_args()

    overrides = {}
    for pair in args.set:
        tid, _, iso = pair.partition("=")
        overrides[int(tid)] = datetime.fromisoformat(iso)

    db: Session = SessionLocal()
    try:
        rows = db.execute(
            select(StockTransfer.id, StockTransfer.document_number,
                   StockTransfer.created_at, func.min(StockMovement.created_at))
            .join(StockMovement,
                  (StockMovement.source_doc_type == transfer_service.MOVEMENT_DOC)
                  & (StockMovement.source_doc_id == StockTransfer.id), isouter=True)
            # المستندات اللي اتنقلت من a5 اتعملت أول يناير فعلاً، فتاريخ اعتمادها
            # صح. اللي بيتصلّح هو اللي اتكتب بعد كده وتاريخ اعتماده فضل أول يناير.
            .where(StockTransfer.approved_at == STUCK,
                   StockTransfer.created_at > STUCK)
            .group_by(StockTransfer.id, StockTransfer.document_number,
                      StockTransfer.created_at)
            .order_by(StockTransfer.id)
        ).all()

        if not rows:
            print("مافيش مستند تاريخ اعتماده ثابت.")
            return

        print(f"{'id':>6} {'المستند':<16} {'اتعمل':<20} {'أقدم حركة':<20} {'هيتكتب':<20} الحالة")
        plan: dict[int, datetime] = {}
        for tid, doc, created, first in rows:
            forced = overrides.get(tid)
            if forced is not None:
                plan[tid] = forced
                state = "صريح (--set)"
            elif first is None:
                state = "مافيش حركات — بيتساب"
            elif first < created:
                state = "الحركة أقدم من المستند — بيتساب"
            elif first - created > SANE_GAP:
                state = "الحركة اتكتبت تاني — محتاج --set"
            else:
                plan[tid] = first
                state = "من أقدم حركة"
            shown = plan.get(tid)
            print(f"{tid:>6} {doc:<16} {str(created)[:19]:<20} {str(first)[:19]:<20} "
                  f"{str(shown)[:19] if shown else '—':<20} {state}")

        print()
        print(f"هيتصلّح: {len(plan)} من {len(rows)}")
        if not args.apply:
            print()
            print("عرض بس — للكتابة زوّد --apply")
            return

        for tid, when in plan.items():
            db.get(StockTransfer, tid).approved_at = when
        db.commit()
        print()
        print(f"اتكتب: {len(plan)} مستند")
        left = db.scalar(select(func.count(StockTransfer.id)).where(
            StockTransfer.approved_at == STUCK, StockTransfer.created_at > STUCK))
        print(f"الباقي بتاريخ ثابت: {left}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
