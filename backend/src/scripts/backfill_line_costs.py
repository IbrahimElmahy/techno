# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.core.db import SessionLocal
from src.core.money import to_money
from src.models.catalog import Item
from src.models.purchasing import PurchaseInvoiceLine
from src.models.sales import SalesInvoiceLine
from src.services import costing_service

ZERO = Decimal("0")


def _fallback_from_sales(db: Session, item_id: int) -> Decimal | None:
    avg = db.scalar(
        select(func.avg(SalesInvoiceLine.unit_cost))
        .where(SalesInvoiceLine.item_id == item_id,
               SalesInvoiceLine.unit_cost.is_not(None))
    )
    return to_money(avg) if avg is not None else None


def _has_purchases(db: Session, item_id: int) -> bool:
    return db.scalar(
        select(func.count(PurchaseInvoiceLine.id))
        .where(PurchaseInvoiceLine.item_id == item_id)
    ) > 0


def plan(db: Session) -> tuple[dict[int, Decimal], list[int], dict[int, int]]:
    counts: dict[int, int] = defaultdict(int)
    for (item_id,) in db.execute(
        select(SalesInvoiceLine.item_id).where(SalesInvoiceLine.unit_cost.is_(None))
    ).all():
        counts[item_id] += 1

    costs: dict[int, Decimal] = {}
    unknown: list[int] = []
    for item_id in counts:
        if _has_purchases(db, item_id):
            costs[item_id] = to_money(costing_service.average_cost(db, item_id))
            continue
        from_sales = _fallback_from_sales(db, item_id)
        if from_sales is None:
            unknown.append(item_id)
        else:
            costs[item_id] = from_sales
    return costs, unknown, counts


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true", help="اكتب فعلاً")
    args = ap.parse_args()

    db: Session = SessionLocal()
    try:
        costs, unknown, counts = plan(db)
        names = {
            i.id: f"{i.code} — {i.name}"
            for i in db.scalars(select(Item).where(Item.id.in_(list(counts)))).all()
        }
        total_lines = sum(counts.values())
        print(f"سطور من غير تكلفة: {total_lines} على {len(counts)} صنف")
        print()
        print(f"{'صنف':>6}  {'الاسم':<40} {'سطور':>6} {'التكلفة':>12}  المصدر")
        fixed = 0
        for item_id, n in sorted(counts.items(), key=lambda kv: -kv[1]):
            if item_id in costs:
                src = "متوسط الشرا" if _has_purchases(db, item_id) else "مبيعاته التانية"
                print(f"{item_id:>6}  {names.get(item_id,'?')[:40]:<40} {n:>6} "
                      f"{costs[item_id]:>12,.2f}  {src}")
                fixed += n
            else:
                print(f"{item_id:>6}  {names.get(item_id,'?')[:40]:<40} {n:>6} "
                      f"{'—':>12}  مافيش أي أثر، بيتساب فاضي")
        print()
        print(f"هيتصلّح: {fixed} سطر | هيفضل فاضي: {total_lines - fixed} سطر "
              f"على {len(unknown)} صنف")

        if not args.apply:
            print()
            print("عرض بس — للكتابة زوّد --apply")
            return

        written = 0
        for item_id, cost in costs.items():
            written += db.query(SalesInvoiceLine).filter(
                SalesInvoiceLine.item_id == item_id,
                SalesInvoiceLine.unit_cost.is_(None),
            ).update({SalesInvoiceLine.unit_cost: cost}, synchronize_session=False)
        db.commit()
        print()
        print(f"اتكتب: {written} سطر")

        left = db.scalar(select(func.count(SalesInvoiceLine.id))
                         .where(SalesInvoiceLine.unit_cost.is_(None)))
        print(f"الباقي من غير تكلفة: {left} سطر")
    finally:
        db.close()


if __name__ == "__main__":
    main()
