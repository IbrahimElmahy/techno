from __future__ import annotations

import sys

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.customer import Customer
from src.models.lookup import LookupOption
from src.models.purchasing import PurchaseInvoice
from src.models.sales import SalesInvoice
from src.models.supplier import Supplier

SUPPLIER_OPTIONS: list[tuple[str, str]] = [
    ("internal", "فرع/مصنع تابع"),
    ("factory", "مصنع"),
    ("company", "شركة"),
    ("person", "مورد فرد"),
    ("cash", "مورد نقدي"),
    ("expense", "بند مصروف"),
]

SUPPLIER_TYPES: dict[str, str] = {
    "A5-2": "internal",
    "A5-3": "internal",
    "AL-A5-10": "internal",
    "AL-A5X4": "internal",
    "AL-A5-17": "factory",
    "AL-A5-31": "factory",
    "AL-A5-1": "company",
    "AL-A5-5": "company",
    "AL-A5-7": "company",
    "AL-A5-13": "company",
    "AL-A5-15": "company",
    "AL-A5-19": "company",
    "AL-A5-20": "company",
    "AL-A5-22": "company",
    "AL-A5-29": "company",
    "AL-A5-2": "person",
    "AL-A5-3": "person",
    "AL-A5-4": "person",
    "AL-A5-6": "person",
    "AL-A5-8": "person",
    "AL-A5-9": "person",
    "AL-A5-11": "person",
    "AL-A5-12": "person",
    "AL-A5-16": "person",
    "AL-A5-18": "person",
    "AL-A5-24": "person",
    "AL-A5-25": "person",
    "AL-A5-26": "person",
    "AL-A5-30": "person",
    "AL-A5-32": "person",
    "AL-A5-21": "person",
    "A5-1": "cash",
    "AL-A5-14": "cash",
    "AL-A5-23": "cash",
    "AL-A5-27": "cash",
    "A5-4": "expense",
}

INTERNAL_CUSTOMER_CODES: list[str] = [
    "AL-A5X2",
    "AL-A5X3",
    "AL-A5-3193",
    "A5X1",
    "A5X5",
    "A5-41",
    "AL-A5-3202",
    "A5-285",
    "A5-338",
    "A5-375",
    "AL-A5-1042",
    "AL-A5-7458",
    "AL-A5-902",
]


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        have = {
            o.value for o in db.scalars(select(LookupOption).where(
                LookupOption.category == "supplier_type"))
        }
        missing = [(v, lbl) for v, lbl in SUPPLIER_OPTIONS if v not in have]

        sups = {s.code: s for s in db.scalars(select(Supplier))}
        sup_plan: list[tuple[Supplier, str, int]] = []
        unknown_codes = [c for c in SUPPLIER_TYPES if c not in sups]
        for code, typ in SUPPLIER_TYPES.items():
            s = sups.get(code)
            if s is None or s.supplier_type == typ:
                continue
            n = db.scalar(select(func.count()).select_from(PurchaseInvoice)
                          .where(PurchaseInvoice.supplier_id == s.id)) or 0
            sup_plan.append((s, typ, n))
        untyped = [s for c, s in sups.items() if c not in SUPPLIER_TYPES]

        cust_plan: list[tuple[Customer, str, int]] = []
        missing_cust: list[str] = []
        for code in INTERNAL_CUSTOMER_CODES:
            c = db.scalar(select(Customer).where(Customer.code == code))
            if c is None:
                missing_cust.append(code)
                continue
            if c.customer_type == "internal":
                continue
            n = db.scalar(select(func.count()).select_from(SalesInvoice)
                          .where(SalesInvoice.customer_id == c.id)) or 0
            cust_plan.append((c, c.customer_type, n))

        if missing:
            print("خيارات تصنيف المورد هتتعمل: "
                  + "، ".join(lbl for _v, lbl in missing) + "\n")

        print(f"{'المورد':<28}{'التصنيف':<16}{'مشتريات':>8}")
        print("-" * 54)
        for s, typ, n in sorted(sup_plan, key=lambda r: -r[2]):
            print(f"{(s.name or '')[:26]:<28}{typ:<16}{n:>8}")
        print(f"\nموردين هيتصنّفوا: {len(sup_plan)}")

        print(f"\n{'الكارت الداخلي':<30}{'كان':<14}{'فواتير بيع':>10}")
        print("-" * 56)
        for c, was, n in sorted(cust_plan, key=lambda r: -r[2]):
            print(f"{(c.name or '')[:28]:<30}{was:<14}{n:>10}")
        print(f"\nكروت هتتعلّم «داخلي»: {len(cust_plan)}")

        if untyped:
            print(f"\n⚠️ موردين مش في الخريطة ({len(untyped)}) — هيفضلوا من غير تصنيف:")
            for s in untyped:
                print(f"   {s.code:<12}{s.name}")
        if unknown_codes:
            print(f"\n⚠️ أكواد في الخريطة مش في القاعدة: {'، '.join(unknown_codes)}")
        if missing_cust:
            print(f"\n⚠️ كروت مش موجودة: {'، '.join(missing_cust)}")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for v, lbl in missing:
            db.add(LookupOption(category="supplier_type", value=v, label=lbl, active=True))
        if not db.scalar(select(LookupOption).where(
                LookupOption.category == "customer_type",
                LookupOption.value == "internal")):
            db.add(LookupOption(category="customer_type", value="internal",
                                label="فرع/شركة تابعة", active=True))
        for s, typ, _n in sup_plan:
            s.supplier_type = typ
        for c, _was, _n in cust_plan:
            c.customer_type = "internal"
            c.employee_id = None
        db.commit()

        print(f"\n✔ موردين اتصنّفوا: {len(sup_plan)}   ·   كروت داخلية: {len(cust_plan)}")
        for v, _lbl in SUPPLIER_OPTIONS:
            n = db.scalar(select(func.count()).select_from(Supplier)
                          .where(Supplier.supplier_type == v)) or 0
            print(f"   {v:<12}{n:>4}")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
