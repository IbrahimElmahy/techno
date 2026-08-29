"""يضبط تصنيفات العملاء على التلاتة اللي الشغل ماشي بيهم: تاجر، سباك، مالك.

    python -m src.scripts.fix_customer_types          # يعرض بس
    python -m src.scripts.fix_customer_types --yes    # ينفّذ

بيتعاد تشغيله بأمان.

---------------------------------------------------------------------------
تلات قرارات:

* **التصنيف مش موجود في a5، فكل اللي اتنقل تاجر.** فحصنا الـ٤٤ عمود في جدول العملاء
  عندهم: `Mrtb_Typ` فاضي على الـ١٣٠٦، و`MntPrd` صفر، و`Cust_memo` كله «الادارة»،
  و`Cust_Comp` أرقام موبايل، و`Cmm` عمولة ثابتة. ومافيش جدول تصنيفات ولا تفريع في شجرة
  الحسابات — كلهم تحت «العملاء».

  تشغيلة سابقة اشتقّت «معرض/شركة/مؤسسة» من اسم العميل. الاشتقاق ده اتشال: هو تخمين مالوش
  أصل في الداتا، والشغل ماشي بتلات تصنيفات مالهاش علاقة بيه.

* **التلاتة ليهم معنى في الشغل، مش تسميات.** التاجر بيشتري ويبيع. السباك اللي الكوبون
  بيرجع منه (والتاجر كمان بيرجّع كوبونات). المالك صاحب البيت اللي المعاينة عنده.

* **`owner` لازم يبقى بالحرف ده.** تطبيق المندوب بيفلتر عليه بالنص (`kOwnerCustomerType`)
  عشان يملا خانة المالك في المعاينة، فاسم مختلف معناه خانة فاضية على التليفون.
"""
from __future__ import annotations

import sys

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.customer import Customer
from src.models.lookup import LookupOption

CATEGORY = "customer_type"

# القيمة، الاسم المعروض. الترتيب ده اللي بيظهر في القايمة.
WANTED: list[tuple[str, str]] = [
    ("trader", "تاجر"),
    ("plumber", "سباك"),
    ("owner", "مالك"),
]
DEFAULT = "trader"


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        options = db.scalars(
            select(LookupOption).where(LookupOption.category == CATEGORY)).all()
        have = {o.value: o for o in options}
        keep = {v for v, _ in WANTED}
        add = [(v, label) for v, label in WANTED if v not in have]
        drop = [o for o in options if o.value not in keep and o.active]

        counts: dict[str, int] = {}
        customers = db.scalars(select(Customer)).all()
        for c in customers:
            counts[c.customer_type or "(فاضي)"] = counts.get(c.customer_type or "(فاضي)", 0) + 1
        moving = sum(n for v, n in counts.items() if v not in keep)

        print("التصنيف دلوقتي:")
        for value, n in sorted(counts.items(), key=lambda x: -x[1]):
            mark = "" if value in keep else "  ← هيبقى تاجر"
            print(f"   {value:<16}{n:>6}{mark}")
        print(f"\nالقايمة: هيتضاف {[label for _v, label in add]}، "
              f"هيتقفل {[o.label for o in drop]}")
        print(f"عملاء هيتحوّلوا لتاجر: {moving}")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for order, (value, label) in enumerate(WANTED, start=1):
            existing = have.get(value)
            if existing is None:
                db.add(LookupOption(category=CATEGORY, value=value, label=label,
                                    sort_order=order, active=True, is_system=False))
            else:
                existing.label = label
                existing.sort_order = order
                existing.active = True
        # بتتقفل مابتتشالش: عميل اتصنّف بواحدة منهم بإيد حد لازم يفضل يلاقي اسمها.
        for o in drop:
            o.active = False
        for c in customers:
            if c.customer_type not in keep:
                c.customer_type = DEFAULT
        db.commit()
        print(f"\nاتحوّل {moving} عميل لتاجر، والقايمة بقت: "
              + "، ".join(label for _v, label in WANTED))
        print("تم.")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
