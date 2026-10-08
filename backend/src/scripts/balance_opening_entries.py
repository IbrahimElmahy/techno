from __future__ import annotations

import sys
from decimal import Decimal

from sqlalchemy import case, func, select

from src.core.db import SessionLocal
from src.models.ledger import Direction, LedgerEntry, LedgerLine
from src.services import account_resolver

STATEMENT = "فرق قيد الافتتاح المنقول من a5"


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        entries = db.scalars(select(LedgerEntry).where(
            LedgerEntry.entry_type == "opening_balance")).all()

        plan: list[tuple[LedgerEntry, Decimal, int]] = []
        for e in entries:
            diff = db.scalar(
                select(func.coalesce(func.sum(
                    case((LedgerLine.direction == Direction.debit, LedgerLine.amount),
                              else_=-LedgerLine.amount)), 0))
                .where(LedgerLine.entry_id == e.id)) or Decimal("0")
            if diff == 0:
                continue
            n = db.scalar(select(func.count()).select_from(LedgerLine)
                          .where(LedgerLine.entry_id == e.id)) or 0
            plan.append((e, Decimal(diff), n))

        print(f"{'القيد':<8}{'الفرع':<6}{'سطور':>7}{'الفرق':>18}")
        print("-" * 42)
        for e, diff, n in plan:
            print(f"#{e.id:<7}{str(e.branch_id or '—'):<6}{n:>7}{diff:>18,.2f}")
        total = sum((d for _e, d, _n in plan), Decimal("0"))
        print(f"\nقيود مش متوازنة: {len(plan)}   ·   إجمالي الفرق: {total:,.2f}")

        if not plan:
            print("\nكل قيود الافتتاح متوازنة — مافيش حاجة تتعمل.")
            return

        for e, diff, _n in plan:
            eq = account_resolver.opening_balance_equity_account(db, branch_id=e.branch_id)
            side = "دائن" if diff > 0 else "مدين"
            print(f"   #{e.id}: سطر {side} {abs(diff):,.2f} على «{eq.name or eq.code}» (#{eq.id})")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for e, diff, _n in plan:
            eq = account_resolver.opening_balance_equity_account(db, branch_id=e.branch_id)
            db.add(LedgerLine(
                entry_id=e.id, account_id=eq.id,
                direction=Direction.credit if diff > 0 else Direction.debit,
                amount=abs(diff), statement=STATEMENT))
        db.commit()

        left = 0
        for e in entries:
            d = db.scalar(
                select(func.coalesce(func.sum(
                    case((LedgerLine.direction == Direction.debit, LedgerLine.amount),
                              else_=-LedgerLine.amount)), 0))
                .where(LedgerLine.entry_id == e.id)) or 0
            if d != 0:
                left += 1
        print(f"\n✔ اتعمل {len(plan)} سطر موازنة. قيود افتتاح لسه مش متوازنة: {left}")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
