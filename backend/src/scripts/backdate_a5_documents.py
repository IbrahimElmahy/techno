from __future__ import annotations

import sys

from sqlalchemy import DateTime, func, select, text, update

from src.core.db import SessionLocal
from src.models.purchasing import PurchaseInvoice, PurchaseReturn
from src.models.sales import SalesInvoice, SalesReturn
from src.models.stock_permit import StockPermit
from src.models.transfer import StockTransfer

DOCS = (
    (SalesInvoice, "invoice_date", "فواتير بيع"),
    (SalesReturn, "return_date", "مردود بيع"),
    (PurchaseInvoice, "purchase_date", "فواتير شراء"),
    (PurchaseReturn, "return_date", "مردود شراء"),
    (StockTransfer, "transfer_date", "تحويلات"),
    (StockPermit, "permit_date", "أذون مخزن"),
)


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        plan = []
        print(f"{'المستند':<16}{'الكل':>8}{'هيتصلّح':>10}{'بلا تاريخ':>11}   المدى")
        print("-" * 66)
        for model, col, label in DOCS:
            src = getattr(model, col)
            total = db.scalar(select(func.count()).select_from(model)) or 0
            blank = db.scalar(select(func.count()).select_from(model)
                              .where(src.is_(None))) or 0
            need = db.scalar(
                select(func.count()).select_from(model)
                .where(src.is_not(None), func.date(model.created_at) != src)) or 0
            lo, hi = db.execute(
                select(func.min(src), func.max(src)).where(src.is_not(None))).one()
            print(f"{label:<16}{total:>8,}{need:>10,}{blank:>11,}   {lo} → {hi}")
            if need:
                plan.append((model, col, label, need))

        if not plan:
            print("\n✔ كل المستندات تاريخها مظبوط خلاص.")
            return
        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        done = 0
        for model, col, label, _ in plan:
            src = getattr(model, col)
            n = db.execute(
                update(model)
                .where(src.is_not(None), func.date(model.created_at) != src)
                .values(created_at=func.cast(src, DateTime) + text("interval '12 hours'"))
            ).rowcount
            print(f"   {label:<16}{n:>8,}")
            done += n
        db.commit()

        print(f"\n✔ اتصلّح {done:,} مستند. التحقق:")
        bad = 0
        for model, col, label in DOCS:
            src = getattr(model, col)
            left = db.scalar(select(func.count()).select_from(model)
                             .where(src.is_not(None),
                                    func.date(model.created_at) != src)) or 0
            lo, hi = db.execute(select(func.min(model.created_at),
                                       func.max(model.created_at))).one()
            mark = "✔" if not left else "✘"
            bad += left
            print(f"{mark} {label:<16} لسه مختلف {left:>6}   {lo} → {hi}")
        if bad:
            sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
