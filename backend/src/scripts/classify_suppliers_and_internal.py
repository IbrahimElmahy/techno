"""يصنّف الموردين، ويعلّم الأطراف **الداخلية** على الجهتين — عميل ومورد.

    python -m src.scripts.classify_suppliers_and_internal          # يعرض بس
    python -m src.scripts.classify_suppliers_and_internal --yes    # ينفّذ

حاجتين اتكشفوا مع بعض:

**١) الموردين مالهمش تصنيف خالص.** `supplier.supplier_type` موجود في الموديل وفاضي
في الـ٣٦ كلهم — `classify_a5_parties` كان بيصنّف العملاء بس. فقايمة الموردين فيها
«ايجارات» و«مورد نقدى» و«مصنع الرواد» و«شركة أكواتيك» كلهم بنفس الشكل، ومافيش طريقة
تفلتر ولا تقرير يفرّق.

**٢) والأهم: أربع كيانات داخلية بتتعامل كموردين برّانيين.**

    تكنووو ثيرم ................ ٢٣٧ فاتورة شرا  (+ ١١٤ فاتورة بيع كعميل)
    المصنع السادات ............. ١٠٩
    العلياء .................... ٥٧            (+ ١٩ كعميل)
    تكنو ثيرم فرع اكتوبر ....... ١٩            (+ ٥٧ و٢٦ كعميل)

دي فروعنا ومصنعنا. الشرا منهم **مش شرا** — ده نقل بضاعة جوّه الشركة. وطول ما هما
متصنّفين موردين عاديين، رقم «المشتريات» بيتضخّم بحاجة مااتشترتش من برّه، وبيبان علينا
دين لنفسنا. نفس الحكاية على جهة البيع.

⚠️ **الاسم لوحده مايكفيش، والقايمة صريحة عشان كده.** «معرض الشلال اكتوبر» فيه كلمة
«اكتوبر» وهو معرض في مدينة أكتوبر — عميل برّاني عادي، مش فرعنا. و«تكنو ربيع المرحومى»
فيه «تكنو» وهو كارت خط بولي لراجل حقيقي. أي `regex` على «تكنو|اكتوبر» كان هيبلع
التلاتين دول. فاللي هنا مكتوب بالكود، واحد واحد.

**بيتغيّر التصنيف بس** — ولا فاتورة ولا قيد ولا رصيد بيتلمس. تحويل المستندات الداخلية
من «شرا» لـ«نقل بين الفروع» قرار تاني بمستنداته، مش شغل السكربت ده.
"""
from __future__ import annotations

import sys

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.customer import Customer
from src.models.lookup import LookupOption
from src.models.purchasing import PurchaseInvoice
from src.models.sales import SalesInvoice
from src.models.supplier import Supplier

# التصنيفات الجديدة للموردين. «داخلي» هو المهم — الباقي للفلترة والتقارير.
SUPPLIER_OPTIONS: list[tuple[str, str]] = [
    ("internal", "فرع/مصنع تابع"),
    ("factory", "مصنع"),
    ("company", "شركة"),
    ("person", "مورد فرد"),
    ("cash", "مورد نقدي"),
    ("expense", "بند مصروف"),
]

# كود المورد → التصنيف. بالكود مش بالاسم: الاسم بيتعدّل من الشاشة، والكود من a5 وثابت.
SUPPLIER_TYPES: dict[str, str] = {
    # ── الداخلي: فروعنا ومصنعنا. الشرا منهم نقل مش شرا. ──
    "A5-2": "internal",      # المصنع السادات
    "A5-3": "internal",      # العلياء
    "AL-A5-10": "internal",  # تكنووو ثيرم
    "AL-A5X4": "internal",   # تكنو ثيرم فرع اكتوبر
    # ── مصانع ──
    "AL-A5-17": "factory",   # مصنع غراء (م/أسامه)
    "AL-A5-31": "factory",   # مصنع الرواد م عصام
    # ── شركات ──
    "AL-A5-1": "company",    # النيل ثيرم
    "AL-A5-5": "company",    # شركه التقوى
    "AL-A5-7": "company",    # شركه العمار
    "AL-A5-13": "company",   # شركه اكواتيك بولى ايثيلين
    "AL-A5-15": "company",   # شركة أكواتيك
    "AL-A5-19": "company",   # شركة مريم
    "AL-A5-20": "company",   # غراء - شركة التقوى
    "AL-A5-22": "company",   # شركة البحرين
    "AL-A5-29": "company",   # شركة بيور
    # ── أفراد ──
    "AL-A5-2": "person",     # الحاج مصطفى ديمكو
    "AL-A5-3": "person",     # أ/حازم
    "AL-A5-4": "person",     # الحاج سمير صبرى
    "AL-A5-6": "person",     # على عمر
    "AL-A5-8": "person",     # على الحناوى
    "AL-A5-9": "person",     # محمد شعبان (الفراعنه)
    "AL-A5-11": "person",    # محفوظ رمادى
    "AL-A5-12": "person",    # اشرف جنيدى
    "AL-A5-16": "person",    # دكتور محمود
    "AL-A5-18": "person",    # حماده الشافعى
    "AL-A5-24": "person",    # مجدى الدرس
    "AL-A5-25": "person",    # المهندس وليد
    "AL-A5-26": "person",    # أ/محمد جمال
    "AL-A5-30": "person",    # ا اسماء دعاية
    "AL-A5-32": "person",    # ا ياسر البحر الاحمر
    "AL-A5-21": "person",    # الشيخ عبدالمنعم
    # ── نقدي: مشتريات متفرقة مالهاش مورد بعينه ──
    "A5-1": "cash",          # @@ مورد نقدى
    "AL-A5-14": "cash",      # مورد اخر
    "AL-A5-23": "cash",      # مورد نقدى عدد خدمة عملاء
    "AL-A5-27": "cash",      # مورد سيارات
    # ── مصروف: مش مورد أصلاً، ده بند بيتصرف عليه ──
    "A5-4": "expense",       # ايجارات
}

# كروت العملاء اللي هي فروعنا. بالكود — «معرض الشلال اكتوبر» عميل برّاني وماينفعش
# يتخلط بيهم، و«تكنو <اسم شخص>» كارت خط بولي لراجل حقيقي.
INTERNAL_CUSTOMER_CODES: list[str] = [
    "AL-A5X2",     # تكنووو ثيرم
    "AL-A5X3",     # فرع اكتوبر
    "AL-A5-3193",  # ثيرم فرع اكتوبر
    "A5X1",        # العلياء   ← كانت متصنّفة «موظف» غلط
    "A5X5",        # المصنع السادات
    "A5-41",       # شركة العلياء
    "AL-A5-3202",  # شركة العلياء
    "A5-285",      # شركة تكنو ثيرم المنوفيه
    "A5-338",      # شركة تكنو ثيرم الشرقيه
    "A5-375",      # شركة تكنو ثيرم اكتوبر
    "AL-A5-1042",  # ثيرم فرع الشرقية
    "AL-A5-7458",  # ثيرم فرع الفيوم
    "AL-A5-902",   # فرع المنوفية مغلق
]


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        # ---------- خيارات التصنيف ----------
        have = {
            o.value for o in db.scalars(select(LookupOption).where(
                LookupOption.category == "supplier_type"))
        }
        missing = [(v, lbl) for v, lbl in SUPPLIER_OPTIONS if v not in have]

        # ---------- الموردين ----------
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

        # ---------- العملاء الداخليين ----------
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

        # ---------- العرض ----------
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
            # الكارت الداخلي مش موظف — «العلياء» كانت اترابطت بموظف اسمه زيها.
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
