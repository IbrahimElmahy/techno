# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.core.db import SessionLocal
from src.models.stock import StockMovement
from src.models.transfer import StockTransfer
from src.services import transfer_service

STUCK = datetime(2026, 1, 1)
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
