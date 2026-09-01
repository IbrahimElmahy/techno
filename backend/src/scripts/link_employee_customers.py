"""يربط كارت العميل بصاحبه لما يكون موظف عندنا — ويصنّفه «موظف» مش «تاجر».

    python -m src.scripts.link_employee_customers          # يعرض بس
    python -m src.scripts.link_employee_customers --yes    # ينفّذ

**المشكلة اللي بيحلّها.** a5 مافيهوش خانة تصنيف للعميل خالص — كل العملاء تحت مجموعة
حسابية واحدة اسمها «العملاء». فالموظف اللي بيشتري لنفسه بياخد كارت عميل عادي، ومشترياته
بتعدّي في تقارير التجار وفي حساب العمولات على إنها بيع لتاجر. والتصنيف عندنا مستنتج من
الاسم («معرض فادى» ⇒ معرض)، واللي مالوش بادئة بيقع على «تاجر» — فالموظفين وقعوا هناك.

عندنا ١٩ اسم موجود في «الموظفين» و«العملاء» مع بعض، **١٧ منهم عليهم فواتير فعلاً**
(واحد عليه ٣٢). يعني مش غلطة نقل تتشال — دي حالة شغل حقيقية النظام القديم مش شايفها.

**الحل أحسن من طريقتهم في حاجتين:**

١. **ربط مش تسمية.** `customer.employee_id` بيقول الكارت بتاع مين بالظبط. التصنيف نص
   بيتعدّل من الشاشة وممكن يضيع؛ المفتاح بيفضل، فالرصيد اللي على الموظف ينفع يتقاصّ من
   مرتبه، والتقرير ينفع يستثني مشتريات الموظفين من غير ما يعتمد على كلمة مكتوبة.

٢. **المطابقة بتتقاس مش بتتخمّن.** بالاسم بعد تجريد الهمزات والتاء المربوطة، و**الاسم
   المتكرر بيتقال ومابيتربطش**: «احمد صلاح» موظف واحد وكارتين — ربطه بواحد فيهم بالعشوائي
   بيحطّ مشتريات على راجل غلط. اللي مش واضح بيستنى قرار.

**مابيتغيّرش:** ولا فاتورة ولا قيد ولا رصيد. الكارت بيتربط ويتصنّف، وبس.
"""
from __future__ import annotations

import re
import sys
from collections import defaultdict

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.customer import Customer
from src.models.employee import Employee
from src.models.lookup import LookupOption
from src.models.sales import SalesInvoice


def _bare(s: str) -> str:
    """الاسم مجرّد من اختلافات الكتابة — «أحمد» و«احمد» اسم واحد."""
    s = (s or "").strip()
    s = re.sub(r"[أإآ]", "ا", s)
    s = s.replace("ة", "ه").replace("ى", "ي")
    return re.sub(r"\s+", " ", s)


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        # خانة «موظف» في قايمة التصنيفات — من غيرها الشاشة هتوري قيمة مالهاش عنوان.
        opt = db.scalar(select(LookupOption).where(
            LookupOption.category == "customer_type", LookupOption.value == "employee"))
        need_opt = opt is None

        emp_by_name: dict[str, list[Employee]] = defaultdict(list)
        for e in db.scalars(select(Employee)):
            emp_by_name[_bare(e.name)].append(e)

        cust_by_name: dict[str, list[Customer]] = defaultdict(list)
        for c in db.scalars(select(Customer).where(Customer.active.is_(True))):
            cust_by_name[_bare(c.name)].append(c)

        pairs: list[tuple[Customer, Employee, int]] = []
        ambiguous: list[str] = []
        for key, emps in emp_by_name.items():
            custs = cust_by_name.get(key) or []
            if not custs:
                continue
            if len(emps) > 1 or len(custs) > 1:
                ambiguous.append(
                    f"«{emps[0].name}»: {len(emps)} موظف × {len(custs)} كارت — محتاج قرار")
                continue
            c, e = custs[0], emps[0]
            n = db.scalar(select(func.count()).select_from(SalesInvoice)
                          .where(SalesInvoice.customer_id == c.id)) or 0
            pairs.append((c, e, n))

        print(f"موظفين عندهم كارت عميل: {len(pairs)}"
              + (f"   (و{len(ambiguous)} محتاجين قرار)" if ambiguous else ""))
        if need_opt:
            print("خانة «موظف» مش موجودة في قايمة التصنيفات — هتتعمل.")
        print()
        print(f"{'الموظف':<26}{'الوظيفة':<18}{'التصنيف دلوقتي':<16}{'فواتير':>7}")
        print("-" * 68)
        for c, e, n in sorted(pairs, key=lambda r: -r[2]):
            print(f"{e.name[:24]:<26}{(getattr(e, 'job_title_name', None) or '—')[:16]:<18}"
                  f"{c.customer_type:<16}{n:>7}")

        if ambiguous:
            print("\n⚠️ مش هيتربطوا — الاسم مش بيحدّد شخص واحد:")
            for a in ambiguous:
                print(f"   {a}")

        with_docs = sum(1 for _c, _e, n in pairs if n)
        print(f"\nمنهم عليهم فواتير فعلاً: {with_docs} — دي حالة شغل مش غلطة نقل.")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        if need_opt:
            db.add(LookupOption(category="customer_type", value="employee",
                                label="موظف", active=True))
        for c, e, _n in pairs:
            c.employee_id = e.id
            c.customer_type = "employee"
        db.commit()

        left = db.scalar(select(func.count()).select_from(Customer)
                         .where(Customer.employee_id.is_not(None))) or 0
        print(f"\n✔ اتربط {len(pairs)} كارت، والمصنّفين «موظف» دلوقتي: {left}")
        print("  ولا فاتورة ولا قيد ولا رصيد اتلمس.")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
