from __future__ import annotations

import sys
from collections import Counter

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.coupon_issue import CouponIssue
from src.models.coupon_receipt import CouponReceipt
from src.models.customer import Customer
from src.models.inspection import Inspection
from src.models.sales import SalesInvoice, SalesReturn
from src.models.voucher import Voucher

PLUMBER_TYPES = {"plumber", "سباك"}


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        def ids(col):
            return {v for (v,) in db.execute(select(col).distinct()).all() if v}

        busy = set()
        for col in (SalesInvoice.customer_id, SalesReturn.customer_id, Voucher.customer_id,
                    CouponReceipt.customer_id, CouponIssue.customer_id,
                    Inspection.customer_id, Inspection.merchant_customer_id):
            busy |= ids(col)

        rows = db.scalars(select(Customer).where(Customer.active.is_(True))).all()
        erp = [c for c in rows if (c.code or "").startswith("ERP-")]
        idle = [c for c in erp if c.id not in busy]
        kept = [c for c in erp if c.id in busy]

        by_type = Counter(c.customer_type for c in idle)
        print("١) أطراف ERP بلا أي حركة — هتتقفل")
        print(f"   {'أطراف ERP نشطة':<30}{len(erp):>7}")
        print(f"   {'   عليها حركة (هتفضل)':<30}{len(kept):>7}")
        print(f"   {'   بلا حركة (هتتقفل)':<30}{len(idle):>7}")
        for t, n in by_type.most_common():
            print(f"      {str(t):<27}{n:>7}")

        plumbers = [c for c in rows
                    if c.customer_type in PLUMBER_TYPES and c.rep_id is not None]
        print(f"\n٢) سباكين عليهم مندوب مبيعات: {len(plumbers)}")
        print("   `rep_id` مش بتقبل فاضي (قيد مقصود) — بلاغ بس، مش بيتغيّر هنا.")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for c in idle:
            c.active = False
        db.commit()
        print(f"\n✔ اتقفل {len(idle)} طرف. السباكين مااتلمسوش.")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
