# -*- coding: utf-8 -*-
"""كميات بكسور عشرية — فين وقد إيه وجاية منين.

    python -m src.scripts.audit_fractional_quantities
    python -m src.scripts.audit_fractional_quantities --branch 3

الكمية `DECIMAL(18,3)` عشان الأصناف اللي بتتباع بالمتر والكيلو. لكن الصنف اللي
بيتباع بالقطعة كميته لازم تكون صحيحة — و«١٨٫٦٦٧ قطعة» مش كمية، دي نتيجة قسمة.

السكربت بيعدّ السطور اللي كميتها مش رقم صحيح في كل نوع مستند، ويورّي عيّنة
بالوحدة ومعامل التحويل — لأن أغلب الكسور بتيجي من هناك: سطر اتكتب بوحدة
(كرتونة مثلاً) ومعاملها مابيقسمش الكمية قسمة صحيحة على القطعة.
"""
from __future__ import annotations

import argparse
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.catalog import Item


def _frac(v) -> bool:
    if v is None:
        return False
    d = Decimal(str(v))
    return d != d.to_integral_value()


def main() -> None:
    ap = argparse.ArgumentParser(description="جرد الكميات الكسرية")
    ap.add_argument("--branch", type=int, help="فرع معيّن")
    ap.add_argument("--limit", type=int, default=12, help="حجم العيّنة")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        from src.models.purchasing import PurchaseInvoice, PurchaseInvoiceLine
        from src.models.sales import SalesInvoice, SalesInvoiceLine, SalesReturn, SalesReturnLine
        from src.models.transfer import StockTransfer, StockTransferLine

        specs = [
            ("فاتورة بيع", SalesInvoiceLine, SalesInvoice,
             SalesInvoiceLine.invoice_id, SalesInvoice.branch_id),
            ("مرتجع بيع", SalesReturnLine, SalesReturn,
             SalesReturnLine.return_id, SalesReturn.branch_id),
            ("فاتورة شراء", PurchaseInvoiceLine, PurchaseInvoice,
             PurchaseInvoiceLine.invoice_id, PurchaseInvoice.branch_id),
            ("إذن تحويل", StockTransferLine, StockTransfer,
             StockTransferLine.transfer_id, StockTransfer.branch_id),
        ]

        print(f"{'المستند':<16}{'سطور':>10}{'كسرية':>10}{'النسبة':>10}")
        samples: list[tuple] = []
        for label, LineM, HeadM, fk, branch_col in specs:
            stmt = select(LineM, HeadM).join(HeadM, fk == HeadM.id)
            if args.branch is not None:
                stmt = stmt.where(branch_col == args.branch)
            rows = db.execute(stmt).all()
            frac = [(ln, hd) for ln, hd in rows if _frac(ln.quantity)]
            pct = (len(frac) / len(rows) * 100) if rows else 0
            print(f"{label:<16}{len(rows):>10,}{len(frac):>10,}{pct:>9.1f}%")
            for ln, hd in frac[: args.limit]:
                samples.append((label, hd, ln))

        if not samples:
            print("\nمافيش كميات كسرية.")
            return

        print(f"\n{'المستند':<14}{'الرقم':<16}{'الكمية':>12}{'الوحدة':>12}"
              f"{'المعامل':>10}  الصنف")
        for label, hd, ln in samples[: args.limit * 2]:
            it = db.get(Item, ln.item_id)
            unit = getattr(ln, "unit", None) or (it.unit_of_measure if it else "")
            factor = getattr(ln, "unit_factor", None)
            print(f"{label:<14}{(hd.document_number or ''):<16}"
                  f"{float(ln.quantity):>12,.3f}{str(unit):>12}"
                  f"{(float(factor) if factor is not None else 1):>10,.3f}"
                  f"  {(it.name if it else ln.item_id)}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
