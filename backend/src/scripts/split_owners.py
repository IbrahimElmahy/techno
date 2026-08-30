"""يفصل الملّاك عن كشف العملاء إلى جدول `owner`.

الاستخدام:
    # الخطوة 1: النقل وربط المعاينات (دراي-رن)
    python -m src.scripts.split_owners

    # الخطوة 1 الفعلية:
    python -m src.scripts.split_owners --yes

    # الخطوة 2: الحذف النهائي للـ 7045 مالك من جدول customer (دراي-رن)
    python -m src.scripts.split_owners --purge

    # الخطوة 2 الفعلية:
    python -m src.scripts.split_owners --purge --yes

Idempotent: يمكن إعادة تشغيله بأمان.
"""
from __future__ import annotations

import sys
from collections import Counter
from sqlalchemy import select, text
from src.core.db import SessionLocal
from src.models.customer import Customer
from src.models.inspection import Inspection
from src.models.owner import Owner


def run_split(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        # 1. جلب كل العملاء من نوع مالك
        owner_customers = db.scalars(
            select(Customer).where(Customer.customer_type == "owner")
        ).all()

        existing_owners = db.scalars(select(Owner)).all()
        by_code = {o.code: o for o in existing_owners if o.code}

        # جلب بيانات إضافية من المعاينات الخاصة بهؤلاء الملاك (national_id, floor_number) إن وجدت
        cust_ids = [c.id for c in owner_customers]
        insp_extra = {}
        if cust_ids:
            insp_rows = db.execute(text("""
                SELECT customer_id, national_id, floor_number
                FROM inspection
                WHERE customer_id = ANY(:ids) AND (national_id IS NOT NULL OR floor_number IS NOT NULL)
                ORDER BY id DESC
            """), {"ids": cust_ids}).all()
            for r in insp_rows:
                if r.customer_id not in insp_extra:
                    insp_extra[r.customer_id] = (r.national_id, r.floor_number)

        cust_to_owner: dict[int, Owner] = {}
        counts = Counter()

        for c in owner_customers:
            target_owner = by_code.get(c.code) if c.code else None
            extra_nid, extra_floor = insp_extra.get(c.id, (None, None))
            if target_owner is None:
                target_owner = Owner(
                    code=c.code,
                    name=(c.name or "")[:160],
                    phone=(c.phone or "")[:32] or None,
                    national_id=(extra_nid or "")[:32] or None,
                    governorate_id=c.governorate_id,
                    markaz=c.markaz,
                    address=(c.address or "")[:255] or None,
                    floor_number=(extra_floor or "")[:16] or None,
                    notes=(getattr(c, "notes", None) or "")[:500] or None,
                    territory_id=c.territory_id,
                    branch_id=c.branch_id,
                    service_rep_id=c.service_rep_id,
                    active=c.active,
                    created_at=c.created_at,
                )
                db.add(target_owner)
                counts["ملّاك جدد اتعملوا في جدول owner"] += 1
            else:
                counts["ملّاك موجودين مسبقاً في جدول owner"] += 1

            cust_to_owner[c.id] = target_owner

        db.flush()

        # خريطة المعاينات لكل مالك
        owner_cust_ids = set(cust_to_owner.keys())
        inspections = db.scalars(select(Inspection)).all()

        owners_with_inspection = set()

        for insp in inspections:
            if insp.customer_id in owner_cust_ids:
                owner_obj = cust_to_owner[insp.customer_id]
                insp.owner_id = owner_obj.id
                insp.customer_id = None
                owners_with_inspection.add(insp.customer_id)
                counts["معاينات اتحوّلت من customer_id إلى owner_id"] += 1
            elif insp.customer_id is not None:
                counts["معاينات لسه على عميل حقيقي (تجار/عملاء)"] += 1
            elif insp.owner_id is not None:
                counts["معاينات مربوطة بـ owner_id مسبقاً"] += 1
            else:
                counts["معاينات بدون ربط (نص فقط)"] += 1

        no_insp_owners = len(owner_cust_ids) - len(owners_with_inspection)
        counts["ملّاك مالهمش معاينات"] = max(0, no_insp_owners)

        print("=" * 55)
        print("تقرير نقل الملّاك إلى جدول owner:")
        print("=" * 55)
        print(f"إجمالي الملّاك في customer     : {len(owner_customers):>6}")
        print(f"ملّاك أُضيفوا لـ owner         : {counts['ملّاك جدد اتعملوا في جدول owner']:>6}")
        print(f"ملّاك كانوا موجودين في owner  : {counts['ملّاك موجودين مسبقاً في جدول owner']:>6}")
        print(f"معاينات تم تحويلها لـ owner_id  : {counts['معاينات اتحوّلت من customer_id إلى owner_id']:>6}")
        print(f"معاينات باقية على عميل حقيقي   : {counts['معاينات لسه على عميل حقيقي (تجار/عملاء)']:>6}")
        print(f"ملّاك بدون معاينات             : {counts['ملّاك مالهمش معاينات']:>6}")
        print("-" * 55)

        if not execute:
            print("\n[عرض فقط — DRY RUN] لم يتم حفظ أي تعديل. أضف --yes للتنفيذ الفعلي.")
            return

        db.commit()
        print("\n✔ تم تنفيذ النقل وتحويل المعاينات بنجاح!")
    finally:
        db.close()


def run_purge(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        # فحص أمان صارم قبل حذف أي صف من customer
        owner_customers = db.scalars(
            select(Customer).where(Customer.customer_type == "owner")
        ).all()

        if not owner_customers:
            print("جدول customer نظيف تماماً — لا يوجد أي عميل من نوع 'owner'.")
            return

        owner_ids = [c.id for c in owner_customers]

        # 1. التأكد أن كل مالك له صف في owner
        owners_by_code = {o.code: o for o in db.scalars(select(Owner)).all() if o.code}
        missing_in_owner = [c for c in owner_customers if c.code and c.code not in owners_by_code]
        if missing_in_owner:
            print(f"❌ خطأ أمان: يوجد {len(missing_in_owner)} مالك غير موجودين في جدول owner!")
            for m in missing_in_owner[:5]:
                print(f"  - [{m.id}] {m.code} : {m.name}")
            return

        # 2. التأكد أنه لا توجد معاينة ما زالت تشير إليهم عبر customer_id
        insp_still_linked = db.scalars(
            select(Inspection).where(Inspection.customer_id.in_(owner_ids))
        ).all()
        if insp_still_linked:
            print(f"❌ خطأ أمان: يوجد {len(insp_still_linked)} معاينة ما زالت تشير إلى customer_id لمالك!")
            return

        # 3. التأكد من خلوهم التام من أي حركة مالية أو ربط كتاجر
        sql_check = text("""
            SELECT c.id, c.code, c.name,
                EXISTS(SELECT 1 FROM sales_invoice si WHERE si.customer_id = c.id) AS has_inv,
                EXISTS(SELECT 1 FROM sales_return sr WHERE sr.customer_id = c.id) AS has_ret,
                EXISTS(SELECT 1 FROM voucher v WHERE v.customer_id = c.id) AS has_vch,
                EXISTS(SELECT 1 FROM inspection i WHERE i.merchant_customer_id = c.id) AS has_merch,
                EXISTS(SELECT 1 FROM coupon_receipt cr WHERE cr.customer_id = c.id) AS has_cr,
                EXISTS(SELECT 1 FROM coupon_issue ci WHERE ci.customer_id = c.id) AS has_ci
            FROM customer c
            WHERE c.id = ANY(:ids)
        """)
        violations = []
        for row in db.execute(sql_check, {"ids": owner_ids}).all():
            if any([row.has_inv, row.has_ret, row.has_vch, row.has_merch, row.has_cr, row.has_ci]):
                violations.append(row)

        if violations:
            print(f"❌ خطأ أمان: تم العثور على {len(violations)} مالك مرتبطين بحركات مالية أو كتاجر!")
            for v in violations[:10]:
                print(f"  - [{v.id}] {v.code} : {v.name}")
            return

        print("=" * 55)
        print("تقرير تنظيف جدول customer (حذف الملّاك المنقولين):")
        print("=" * 55)
        print(f"إجمالي الملّاك المستوفين لشروط الحذف بأمان: {len(owner_customers):>6}")
        print("فحوصات الأمان:")
        print("  ✔ جميعهم منقولون في جدول owner بنفس الكود")
        print("  ✔ لا توجد أي معاينة تشير إليهم كـ customer_id")
        print("  ✔ لا توجد فواتير أو مرتجعات أو سندات أو كوبونات")
        print("  ✔ لا يوجد ربط كتاجر في أي معاينة")
        print("-" * 55)

        if not execute:
            print("\n[عرض فقط — DRY RUN] لم يتم حذف أي صف. أضف --yes للحذف الفعلي.")
            return

        # حذف حسابات العملاء التابعة لهم إن وجدت (customer_account)
        accounts_deleted = db.execute(
            text("DELETE FROM customer_account WHERE customer_id = ANY(:ids)"),
            {"ids": owner_ids}
        ).rowcount

        # حذف جهات الاتصال التابعة لهم إن وجدت
        phones_deleted = db.execute(
            text("DELETE FROM contact_phone WHERE owner_type = 'customer' AND owner_id = ANY(:ids)"),
            {"ids": owner_ids}
        ).rowcount

        # حذف صفوف العملاء
        deleted_count = db.execute(
            text("DELETE FROM customer WHERE id = ANY(:ids)"),
            {"ids": owner_ids}
        ).rowcount

        db.commit()
        print(f"\n✔ تم حذف {deleted_count} مالك بنجاح من جدول customer!")
        print(f"  (تم حذف {accounts_deleted} حساب و {phones_deleted} هاتف مرتبطين بهم)")

    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    is_purge = "--purge" in args
    is_yes = "--yes" in args

    if is_purge:
        run_purge(execute=is_yes)
    else:
        run_split(execute=is_yes)
