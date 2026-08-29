"""يصنّف العملاء والموردين المنقولين من a5، ويحطّ كل طرف على فرعه.

    python -m src.scripts.classify_a5_parties          # يعرض بس
    python -m src.scripts.classify_a5_parties --yes    # ينفّذ

بيتعاد تشغيله بأمان: اللي متصنّف بإيد حد مابيتغيّرش.

---------------------------------------------------------------------------
تلات قرارات:

* **a5 مافيهوش خانة تصنيف للعميل.** دوّرنا: `Cust_Comp` طلع رقم تليفون (١٠٥ قيمة كلها
  `01xxxxxxxxx`)، و`Cmm` نسبة عمولة ثابتة على ١٣٠٥ عميل، وحسابات العملاء كلها تحت مجموعة
  واحدة اسمها «العملاء». التصنيف الوحيد الموجود فعلاً هو **اللي مكتوب في الاسم**: «معرض
  فادى»، «شركة مريم»، «مصنع الرواد». ٤٤٨ من ٦٥٠ عميل في أكتوبر اسمهم بيبدأ بـ«معرض».

* **بيتقرا من الاسم ومابيتحطش في الاسم.** الكلمة بتفضل في الاسم زي ما هي — «معرض فادى»
  اسمه كده على الورق. اللي بيتزود هو التصنيف كخانة، عشان الفلترة والتقارير تشتغل.

* **الطرف بيتحط على فرعه من بادئة كوده.** المورد مالوش فرع دلوقتي، يعني كل فرع بيشوف
  موردين التاني — والعزل مبني على `branch_id`. البادئة `AL-` بتقول العلياء و`A5-` بتقول
  أكتوبر، وهي اللي الاستيراد كتبها.
"""
from __future__ import annotations

import re
import sys

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.customer import Customer
from src.models.lookup import LookupOption
from src.models.org import Branch
from src.models.supplier import Supplier

# الكلمة اللي في الاسم → التصنيف. الترتيب مهم: «شركة أكواتيك بولى» شركة مش حاجة تانية.
CUSTOMER_RULES: list[tuple[str, str, str]] = [
    (r"^\s*معرض\b", "showroom", "معرض"),
    (r"^\s*(شرك[ةه]|الشرك[ةه])\b", "company", "شركة"),
    (r"^\s*مصنع\b", "factory", "مصنع"),
    (r"^\s*(مؤسس[ةه]|موسس[ةه])\b", "establishment", "مؤسسة"),
    (r"^\s*(ورش[ةه]|مكتب|مخزن|توكيل)\b", "other", "أخرى"),
]

SUPPLIER_RULES: list[tuple[str, str, str]] = [
    (r"^\s*مصنع\b", "manufacturer", "مصنع"),
    (r"^\s*(شرك[ةه]|الشرك[ةه])\b", "company", "شركة"),
    (r"مورد\s*نقدى|مورد\s*نقدي", "cash", "مورد نقدي"),
]

# البادئة اللي الاستيراد كتبها على الكود → الفرع.
PREFIX_BRANCH = [("AL-", "العلياء"), ("A5-", "أكتوبر"), ("A5X", "أكتوبر")]

DEFAULT_CUSTOMER = ("trader", "تاجر")
DEFAULT_SUPPLIER = ("other", "أخرى")


def _match(name: str, rules: list[tuple[str, str, str]]) -> tuple[str, str] | None:
    for pattern, value, label in rules:
        if re.search(pattern, name or ""):
            return value, label
    return None


def _ensure_options(db, category: str, wanted: dict[str, str]) -> None:
    """القيمة الجديدة لازم تبقى في القايمة، وإلا الشاشة بتعرض كود بدل اسم."""
    have = {o.value for o in db.scalars(
        select(LookupOption).where(LookupOption.category == category)).all()}
    order = db.scalar(select(LookupOption.sort_order).where(
        LookupOption.category == category).order_by(LookupOption.sort_order.desc())) or 0
    for value, label in wanted.items():
        if value in have:
            continue
        order += 1
        db.add(LookupOption(category=category, value=value, label=label,
                            sort_order=order, active=True, is_system=False))
        print(f"   + تصنيف جديد في «{category}»: {label}")


def _branch_of(code: str, branches: dict[str, Branch]) -> Branch | None:
    for prefix, name in PREFIX_BRANCH:
        if (code or "").startswith(prefix):
            return branches.get(name)
    return None


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        branches = {b.name: b for b in db.scalars(select(Branch)).all()}
        customers = db.scalars(select(Customer)).all()
        suppliers = db.scalars(select(Supplier)).all()

        cust_plan: dict[str, int] = {}
        supp_plan: dict[str, int] = {}
        cust_labels: dict[str, str] = {}
        supp_labels: dict[str, str] = {}
        branch_plan = 0

        for c in customers:
            # اللي حد صنّفه بإيده مابيتلمسش — التصنيف الافتراضي بس هو اللي بيتراجع.
            if c.customer_type not in ("", None, DEFAULT_CUSTOMER[0]):
                continue
            hit = _match(c.name, CUSTOMER_RULES)
            if hit is None:
                continue
            value, label = hit
            cust_plan[value] = cust_plan.get(value, 0) + 1
            cust_labels[value] = label

        for s in suppliers:
            if not s.supplier_type:
                hit = _match(s.name, SUPPLIER_RULES)
                if hit is not None:
                    value, label = hit
                    supp_plan[value] = supp_plan.get(value, 0) + 1
                    supp_labels[value] = label
            if s.branch_id is None and _branch_of(s.code, branches) is not None:
                branch_plan += 1

        print(f"عملاء: {len(customers)}   موردين: {len(suppliers)}\n")
        print("تصنيف العملاء من أسمائهم:")
        for value, n in sorted(cust_plan.items(), key=lambda x: -x[1]):
            print(f"   {cust_labels[value]:<12}{n:>6}")
        rest = sum(1 for c in customers
                   if c.customer_type in ("", None, DEFAULT_CUSTOMER[0])) - sum(cust_plan.values())
        print(f"   {'تاجر (الباقي)':<12}{rest:>6}")
        print("\nتصنيف الموردين:")
        for value, n in sorted(supp_plan.items(), key=lambda x: -x[1]):
            print(f"   {supp_labels[value]:<12}{n:>6}")
        print(f"\nموردين هيتحطوا على فرعهم: {branch_plan}")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        print()
        _ensure_options(db, "customer_type",
                        {**cust_labels, DEFAULT_CUSTOMER[0]: DEFAULT_CUSTOMER[1]})
        _ensure_options(db, "supplier_type",
                        {**supp_labels, DEFAULT_SUPPLIER[0]: DEFAULT_SUPPLIER[1]})
        db.flush()

        done = {"عملاء اتصنّفوا": 0, "موردين اتصنّفوا": 0, "موردين على فرعهم": 0}
        for c in customers:
            if c.customer_type not in ("", None, DEFAULT_CUSTOMER[0]):
                continue
            hit = _match(c.name, CUSTOMER_RULES)
            if hit is None:
                c.customer_type = DEFAULT_CUSTOMER[0]
                continue
            c.customer_type = hit[0]
            done["عملاء اتصنّفوا"] += 1
        for s in suppliers:
            if not s.supplier_type:
                hit = _match(s.name, SUPPLIER_RULES)
                s.supplier_type = hit[0] if hit else DEFAULT_SUPPLIER[0]
                if hit:
                    done["موردين اتصنّفوا"] += 1
            if s.branch_id is None:
                b = _branch_of(s.code, branches)
                if b is not None:
                    s.branch_id = b.id
                    done["موردين على فرعهم"] += 1

        db.commit()
        print(f"\n{'الكيان':<22}{'اتعمل':>8}")
        print("-" * 32)
        for k, v in done.items():
            print(f"{k:<22}{v:>8}")
        print("\nتم.")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
