from __future__ import annotations

import os
import sys
from datetime import date, datetime, timedelta

from sqlalchemy import select

from src.core import clock
from src.core.db import SessionLocal
from src.models.purchasing import PurchaseInvoice, PurchaseReturn
from src.models.sales import SalesInvoice, SalesReturn
from src.models.stock_permit import StockPermit
from src.models.transfer import StockTransfer

TARGETS = [
    (SalesInvoice, "invoice_date", "فواتير البيع"),
    (SalesReturn, "return_date", "مردود المبيعات"),
    (PurchaseInvoice, "purchase_date", "فواتير الشراء"),
    (PurchaseReturn, "return_date", "مردود المشتريات"),
    (StockPermit, "permit_date", "أذون المخزن"),
    (StockTransfer, "transfer_date", "أذون التحويل"),
]

SUSPECT_FROM = date(2026, 9, 12)
SUSPECT_TO = date(2026, 9, 16)


def _business_day(ts: datetime) -> date:
    return (ts + timedelta(hours=clock.business_utc_offset_hours())).date()


def run(*, execute: bool, out_path: str | None) -> int:
    lines: list[str] = []

    def say(text: str = "") -> None:
        lines.append(text)
        try:
            print(text)
        except UnicodeEncodeError:
            print(text.encode("ascii", "replace").decode("ascii"))

    db = SessionLocal()
    try:
        say(f"تاريخ اليوم بتوقيت الشغل: {clock.today()}")
        say("")

        grand = grand_suspect = 0
        touched: list[tuple[object, str]] = []

        for cls, col, label in TARGETS:
            total = len(db.scalars(select(cls.id)).all())
            rows = db.scalars(select(cls).where(getattr(cls, col).is_(None))).all()

            say(f"{label}  ({cls.__tablename__}.{col})")
            say(f"   إجمالي الصفوف   {total}")
            say(f"   تاريخها فاضي    {len(rows)}")
            if not rows:
                say("   ← مافيش حاجة تتعمل")
                say("")
                continue

            no_stamp = 0
            for r in sorted(rows, key=lambda x: x.id):
                stamp = getattr(r, "created_at", None)
                num = getattr(r, "document_number", None) or f"#{r.id}"
                if stamp is None:
                    no_stamp += 1
                    say(f"   {num:<16} created_at فاضي  ← مااتلمسش")
                    continue
                new = _business_day(stamp)
                flag = ""
                if SUSPECT_FROM <= new <= SUSPECT_TO:
                    flag = "   ⚠ نافذة الساعة المتأخرة (ممكن يكون أقدم بـ٤ أيام)"
                    grand_suspect += 1
                say(f"   {num:<16} (فاضي) → {new}   من created_at={stamp}{flag}")
                touched.append((r, col))

            if no_stamp:
                say(f"   صفوف من غير created_at: {no_stamp} ← مااتلمستش")
            say("")

        grand = len(touched)
        say(f"الإجمالي: {grand} صف هيتكتب عليه تاريخ"
            f"   منهم {grand_suspect} في نافذة الساعة المتأخرة")
        say("والصفوف اللي تاريخها مكتوب — ومنها كل المنقول من a5 — مااتلمستش أصلاً.")

        if not execute:
            db.rollback()
            say("")
            say("درايَ-رن. `--yes` عشان ينفّذ — **والخانة كانت فاضية فمافيش رجوع**.")
            return 0

        for row, col in touched:
            setattr(row, col, _business_day(row.created_at))
        db.commit()
        say("")
        say(f"اتكتب: {grand} صف.")
        return 0
    finally:
        db.close()
        if out_path:
            os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
            with open(out_path, "w", encoding="utf-8", newline="\n") as fh:
                fh.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    argv = sys.argv[1:]
    out = argv[argv.index("--out") + 1] if "--out" in argv else None
    sys.exit(run(execute="--yes" in argv, out_path=out))
