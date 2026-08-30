"""يصلح حقول المعاينة الناقصة من نظام ما بعد البيع القديم:
التاجر (مفتاح خارجي واسم وتليفون) + نوع الزيارة (مرمة/معاينة) + حالة الطباعة.

    python -m src.scripts.fix_inspection_merchants --dir C:/pgtmp/erp
    python -m src.scripts.fix_inspection_merchants --dir C:/pgtmp/erp --yes

Idempotent: يمكن إعادة تشغيله بأمان في أي وقت.
"""
from __future__ import annotations

import os
import sys
from collections import Counter

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.customer import Customer
from src.models.inspection import Inspection
from src.models.lookup import LookupOption
from src.scripts.import_a5 import _clean, _read
from src.scripts.import_erp_parties import _norm


def run(folder: str, *, execute: bool) -> None:
    merchants_file = os.path.join(folder, "merchants.tsv")
    vfix_file = os.path.join(folder, "vfix.tsv")

    if not os.path.exists(merchants_file):
        raise SystemExit(f"ملف التجار غير موجود: {merchants_file}")
    if not os.path.exists(vfix_file):
        raise SystemExit(f"ملف المعاينات غير موجود: {vfix_file}")

    m_rows = _read(merchants_file)
    v_rows = _read(vfix_file)

    db = SessionLocal()
    try:
        # ---------- 1. خريطة التجار ----------
        customers = db.scalars(select(Customer)).all()
        by_code = {c.code: c for c in customers if c.code}
        by_name = {_norm(c.name): c for c in customers}

        # mid -> (target_customer | None, name, phone, match_kind)
        resolved_merchants: dict[str, tuple[Customer | None, str, str, str]] = {}
        m_counts = Counter()

        for r in m_rows:
            if not r or len(r) < 2:
                continue
            mid = r[0].strip()
            name = _clean(r[1])
            phone = _clean(r[2]) if len(r) > 2 else ""

            target = by_code.get(f"ERP-M-{mid}")
            if target is not None:
                resolved_merchants[mid] = (target, name, phone, "code")
                m_counts["اتحلّوا بالكود"] += 1
            else:
                target = by_name.get(_norm(name))
                if target is not None:
                    resolved_merchants[mid] = (target, name, phone, "name")
                    m_counts["اتحلّوا بالاسم"] += 1
                else:
                    resolved_merchants[mid] = (None, name, phone, "none")
                    m_counts["مالهمش تاجر عندنا"] += 1

        print("=" * 45)
        print("تقرير مطابقة التجار:")
        print("=" * 45)
        print(f"تجار المصدر (wh_Merchants) : {len(m_rows):>6}")
        print(f"اتحلّوا بالكود (ERP-M-*)   : {m_counts['اتحلّوا بالكود']:>6}")
        print(f"اتحلّوا بالاسم (عملاء a5)  : {m_counts['اتحلّوا بالاسم']:>6}")
        print(f"مالهمش تاجر عندنا           : {m_counts['مالهمش تاجر عندنا']:>6}")
        print("-" * 45)

        # ---------- 2. خيارات نوع الزيارة (مرمة / معاينة) ----------
        have_options = {
            o.value
            for o in db.scalars(
                select(LookupOption).where(LookupOption.category == "visit_type")
            ).all()
        }
        order = max(
            [
                o.sort_order
                for o in db.scalars(
                    select(LookupOption).where(LookupOption.category == "visit_type")
                ).all()
            ]
            or [0]
        )
        for opt in ("معاينة", "مرمة"):
            if opt not in have_options:
                order += 1
                db.add(
                    LookupOption(
                        category="visit_type",
                        value=opt,
                        label=opt,
                        sort_order=order,
                        active=True,
                        is_system=False,
                    )
                )
                have_options.add(opt)

        # ---------- 3. تحديث المعاينات ----------
        inspections = db.scalars(select(Inspection)).all()
        by_doc = {i.document_number: i for i in inspections}

        v_counts = Counter()
        for r in v_rows:
            if not r or len(r) < 5:
                continue
            vid, mid, store_text, is_marma, count_print = (
                r[0].strip(),
                r[1].strip(),
                _clean(r[2]),
                r[3].strip(),
                r[4].strip(),
            )

            doc_number = f"ERP-V-{vid}"
            insp = by_doc.get(doc_number)
            if insp is None:
                v_counts["معاينات مش موجودة بالقاعدة"] += 1
                continue

            res = resolved_merchants.get(mid)
            target_cust = res[0] if res else None
            m_name = res[1] if res else ""
            m_phone = res[2] if res else ""

            # التاجر: مفتاح خارجي + اسم نصي وتليفون احتياطي
            if target_cust is not None:
                insp.merchant_customer_id = target_cust.id
                v_counts["معاينات اتربطت بتاجر (FK)"] += 1
            else:
                v_counts["معاينات بدون تاجر مربوط"] += 1

            # اسم وتليفون محل الشراء النصي
            shop_name = store_text or m_name or None
            if shop_name:
                insp.purchase_shop = shop_name[:160]
            if m_phone:
                insp.purchase_shop_phone = m_phone[:40]

            # نوع الزيارة
            if is_marma in ("مرمة", "1"):
                insp.visit_type = "مرمة"
                v_counts["معاينات نوعها مرمة"] += 1
            else:
                insp.visit_type = "معاينة"
                v_counts["معاينات نوعها معاينة"] += 1

            # حالة الطباعة
            is_prt = False
            try:
                is_prt = int(count_print) > 0
            except (ValueError, TypeError):
                pass
            insp.printed = is_prt
            if is_prt:
                v_counts["معاينات مطبوعة"] += 1
            else:
                v_counts["معاينات غير مطبوعة"] += 1

            v_counts["معاينات تم فحصها وتجهيزها"] += 1

        print("\n" + "=" * 45)
        print("تقرير تحديث المعاينات:")
        print("=" * 45)
        for k, v in sorted(v_counts.items()):
            print(f"{k:<30} {v:>8}")
        print("-" * 45)

        if not execute:
            print("\n[عرض فقط — DRY RUN] لم يتم حفظ أي تعديل. أضف --yes للتنفيذ الفعلي.")
            return

        db.commit()
        print("\n✔ تم حفظ كافة التعديلات في قاعدة البيانات بنجاح!")
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp/erp"
    run(folder, execute="--yes" in args)
