"""يحوّل الملّاك الـ١٦ أصحاب الحركات المالية أو المعاينات كتجار إلى تجار (trader).

    python -m src.scripts.fix_owner_traders
    python -m src.scripts.fix_owner_traders --yes

Idempotent: يمكن إعادة تشغيله بأمان في أي وقت.
"""
from __future__ import annotations

import sys
from sqlalchemy import select, text
from src.core.db import SessionLocal
from src.models.customer import Customer, CustomerType


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        # البحث عن الملاك الذين لديهم فواتير، مرتجعات، أو مرتبطين كتاجر في معاينة
        sql = text("""
            SELECT DISTINCT c.id, c.code, c.name,
                EXISTS(SELECT 1 FROM sales_invoice si WHERE si.customer_id = c.id) AS has_invoice,
                EXISTS(SELECT 1 FROM sales_return sr WHERE sr.customer_id = c.id) AS has_return,
                EXISTS(SELECT 1 FROM inspection i WHERE i.merchant_customer_id = c.id) AS has_merchant_insp,
                (SELECT COUNT(*) FROM inspection i WHERE i.merchant_customer_id = c.id) AS merchant_insp_count
            FROM customer c
            WHERE c.customer_type = 'owner'
              AND (
                EXISTS(SELECT 1 FROM sales_invoice si WHERE si.customer_id = c.id)
                OR EXISTS(SELECT 1 FROM sales_return sr WHERE sr.customer_id = c.id)
                OR EXISTS(SELECT 1 FROM inspection i WHERE i.merchant_customer_id = c.id)
              )
            ORDER BY c.id
        """)

        rows = db.execute(sql).all()

        print("=" * 65)
        print(f"الملاك الاستثناءات المطلوب تحويلهم إلى تجار (العدد: {len(rows)}):")
        print("=" * 65)

        if not rows:
            print("لا يوجد أي مالك عليه حركات مالية أو مرتبط كتاجر (تم التحويل بالفعل أو لا يوجد).")
            return

        for r in rows:
            reasons = []
            if r.has_invoice:
                reasons.append("فاتورة بيع")
            if r.has_return:
                reasons.append("مرتجع بيع")
            if r.has_merchant_insp:
                reasons.append(f"تاجر لمعاينات ({r.merchant_insp_count})")
            
            print(f"[{r.id:<5}] كود: {r.code or '—':<12} | الاسم: {r.name:<30} | الأسباب: {', '.join(reasons)}")

        print("-" * 65)

        if not execute:
            print("\n[عرض فقط — DRY RUN] لم يتم حفظ أي تعديل. أضف --yes للتنفيذ الفعلي.")
            return

        # تنفيذ التحويل
        ids = [r.id for r in rows]
        customers = db.scalars(select(Customer).where(Customer.id.in_(ids))).all()
        for c in customers:
            c.customer_type = CustomerType.trader

        db.commit()
        print(f"\n✔ تم تحويل {len(customers)} عميل بنجاح من 'owner' إلى 'trader'!")

    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv)
