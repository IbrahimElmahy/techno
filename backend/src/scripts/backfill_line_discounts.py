from __future__ import annotations

import sys
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.purchasing import PurchaseInvoiceLine, PurchaseReturnLine
from src.lib import discounts
from src.models.sales import SalesInvoiceLine, SalesReturnLine

ZERO = Decimal("0")
CENT = Decimal("0.01")
TOL = Decimal("0.005")

TARGETS = [
    (SalesInvoiceLine, "سطور فواتير البيع"),
    (SalesReturnLine, "سطور مردود المبيعات"),
    (PurchaseInvoiceLine, "سطور فواتير الشراء"),
    (PurchaseReturnLine, "سطور مردود المشتريات"),
]


def run(*, execute: bool) -> int:
    db = SessionLocal()
    try:
        grand = 0
        for cls, label in TARGETS:
            if not hasattr(cls, "discount_pct"):
                print(f"{label}: مافيش عمود خصم — اتخطّى")
                continue

            fixed = off_by_more_than_a_cent = negative = weird = 0
            worst = Decimal("0")
            for ln in db.scalars(select(cls)).all():
                have = Decimal(str(ln.discount_pct or 0))
                if have != ZERO:
                    continue
                qty = Decimal(str(ln.quantity or 0))
                price = Decimal(str(ln.unit_price or 0))
                total = Decimal(str(ln.line_total or 0))
                gross = qty * price
                if gross <= ZERO:
                    continue
                gap = gross - total
                if abs(gap) <= TOL:
                    continue

                pct = discounts.implied_pct(gross, total)
                if pct < ZERO:
                    negative += 1
                    continue
                if pct >= Decimal("100"):
                    weird += 1
                    continue

                ln.discount_pct = pct
                fixed += 1
                left = abs(gross * (1 - pct / 100) - total)
                if left > CENT:
                    off_by_more_than_a_cent += 1
                worst = max(worst, left)

            grand += fixed
            print(f"\n{label}")
            print(f"   هيتكتب عليها خصم        {fixed}")
            if off_by_more_than_a_cent:
                print(f"   فرقها بعد التقريب > قرش {off_by_more_than_a_cent}"
                      f"   (أكبر فرق {worst})")
            if negative:
                print(f"   إجماليها أكبر من الخام  {negative}  ← مااتلمستش")
            if weird:
                print(f"   خصمها ١٠٠٪ أو أكتر      {weird}  ← مااتلمستش")

        if not execute:
            db.rollback()
            print(f"\nالإجمالي: {grand} سطر. درايَ-رن — `--yes` عشان ينفّذ.")
            return 0
        db.commit()
        print(f"\nاتكتب: {grand} سطر.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(run(execute="--yes" in sys.argv[1:]))
