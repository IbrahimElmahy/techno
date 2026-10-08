from __future__ import annotations

import sys
from decimal import Decimal

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.sales import SalesInvoice, SalesInvoiceLine

TOLERANCE = Decimal("0.02")


def run(*, execute: bool, branch: str = "") -> None:
    db = SessionLocal()
    try:
        q = select(SalesInvoice).where(SalesInvoice.net == 0)
        if branch:
            from src.models.org import Branch
            bid = db.scalar(select(Branch.id).where(Branch.name == branch))
            q = q.where(SalesInvoice.branch_id == bid)
        rows = db.scalars(q).all()

        fixable: list[tuple[SalesInvoice, Decimal]] = []
        mismatched: list[tuple[SalesInvoice, Decimal, Decimal]] = []
        truly_zero = 0

        for inv in rows:
            lines_total = db.scalar(
                select(func.coalesce(func.sum(SalesInvoiceLine.line_total), 0))
                .where(SalesInvoiceLine.invoice_id == inv.id)) or Decimal("0")
            lines_total = Decimal(lines_total)
            if lines_total == 0:
                truly_zero += 1
                continue
            gross = Decimal(inv.gross or 0)
            if abs(gross - lines_total) > TOLERANCE:
                mismatched.append((inv, gross, lines_total))
                continue
            fixable.append((inv, gross))

        total = sum((g for _i, g in fixable), Decimal("0"))
        print(f"فواتير `net = 0`:                      {len(rows):>6}")
        print(f"   صافيها صفر فعلاً (سليمة، مش هتتلمس): {truly_zero:>6}")
        print(f"   هيتصلّح (gross = مجموع السطور):      {len(fixable):>6}")
        print(f"   gross مش مطابق لسطوره (هيتقال بس):   {len(mismatched):>6}")
        print(f"\nالقيمة اللي هترجع تبان: {total:,.2f} ج")

        if fixable:
            print("\nأكبر خمسة:")
            for inv, g in sorted(fixable, key=lambda r: -r[1])[:5]:
                print(f"   {inv.document_number:<14}{inv.invoice_date}   {g:>14,.2f}")

        if mismatched:
            print("\n⚠️ مش هيتغيّروا — `gross` مش مطابق لسطورهم:")
            for inv, g, lt in mismatched[:10]:
                print(f"   {inv.document_number:<14}gross={g:,.2f}   سطور={lt:,.2f}")
            if len(mismatched) > 10:
                print(f"   ... و{len(mismatched) - 10} غيرهم")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for inv, gross in fixable:
            inv.net = gross
        db.commit()

        left = db.scalar(
            select(func.count()).select_from(SalesInvoice)
            .where(SalesInvoice.net == 0, SalesInvoice.gross != 0)) or 0
        shown = db.scalar(select(func.coalesce(func.sum(SalesInvoice.net), 0))) or 0
        print(f"\n✔ اتصلّح {len(fixable)} فاتورة.")
        print(f"   لسه `net=0` و`gross` مش صفر: {left}")
        print(f"   إجمالي المبيعات دلوقتي: {Decimal(shown):,.2f} ج")
    finally:
        db.close()


if __name__ == "__main__":
    a = sys.argv[1:]
    run(execute="--yes" in a, branch=a[a.index("--branch") + 1] if "--branch" in a else "")
