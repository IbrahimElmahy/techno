from __future__ import annotations

import argparse

from sqlalchemy import or_, select

from src.core.db import SessionLocal
from src.core.money import ZERO
from src.models.sales import SalesInvoice, SalesInvoiceLine


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true", help="نفّذ (من غيرها بيعرض بس)")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        rows = db.execute(
            select(SalesInvoiceLine, SalesInvoice.document_number)
            .join(SalesInvoice, SalesInvoice.id == SalesInvoiceLine.invoice_id)
            .where(SalesInvoice.is_bonus.is_(True))
            .where(or_(SalesInvoiceLine.fixed_discount_pct.is_(None),
                       SalesInvoiceLine.fixed_discount_pct != 0,
                       SalesInvoiceLine.variable_discount_pct.is_(None),
                       SalesInvoiceLine.variable_discount_pct != 0))
        ).all()
        docs = sorted({num for _, num in rows})
        print(f"{len(rows)} سطر في {len(docs)} فاتورة بونص: {', '.join(docs[:40])}"
              + (" …" if len(docs) > 40 else ""))
        if not args.yes:
            print("عرض بس — شغّله بـ--yes عشان يتنفّذ.")
            return
        for line, _ in rows:
            line.fixed_discount_pct = ZERO
            line.variable_discount_pct = ZERO
        db.commit()
        print("اتصفّروا.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
