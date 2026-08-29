"""يحطّ «النوع» (العائلة) على الفواتير والمرتجعات المنقولة من a5.

عمود «النوع» في شاشة المبيعات فاضي على الـ٨٠١٣ فاتورة كلها: a5 مافيهوش خانة عائلة على
الفاتورة، فالاستيراد ماكانش عنده منين يجيبها.

    python -m src.scripts.set_a5_families          # يعرض بس
    python -m src.scripts.set_a5_families --yes    # ينفّذ

بيتعاد تشغيله بأمان: اللي ليه نوع بالفعل مابيتلمسش.

---------------------------------------------------------------------------
قرارين:

* **العائلة في اسم العميل، لأن ده مكانها عندهم.** a5 مافيهوش حساب عائلة للعميل الواحد،
  فعملوا العميل مرتين: «احمد العسيلى» و«تكنو احمد العسيلى». والخزينة نفسها متقسمة كده —
  «صندوق تكنو السياره (ج)» و«صندوق ابيض السياره (ج)». فالبادئة على اسم العميل هي العائلة.

* **اللي مالوش بادئة «ابيض».** دي العائلة الأصلية — الاسم المجرد هو الحساب الأصلي، والـ
  «تكنو» هو اللي اتفتح بعده. ٤٩٤ عميل في العلياء عندهم الاتنين، وده اللي بيأكّد القراءة.
"""
from __future__ import annotations

import re
import sys
from collections import Counter

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.customer import Customer
from src.models.lookup import LookupOption
from src.models.sales import SalesInvoice, SalesReturn

# البادئة على اسم العميل → العائلة.
PREFIX = [
    (re.compile(r"^\s*تكنو\b"), "تكنو"),
    (re.compile(r"^\s*(ابيض|أبيض)\b"), "ابيض"),
    (re.compile(r"^\s*(بولى|بولي)\b"), "بولي"),
]
DEFAULT = "ابيض"
LOOKUP = "customer_account_family"


def _family(name: str) -> str:
    for rx, value in PREFIX:
        if rx.search(name or ""):
            return value
    return DEFAULT


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        fam = {c.id: _family(c.name) for c in db.scalars(select(Customer)).all()}

        invs = [i for i in db.scalars(select(SalesInvoice)).all() if not i.family]
        rets = [r for r in db.scalars(select(SalesReturn)).all() if not r.family]
        counts = Counter(fam.get(i.customer_id, DEFAULT) for i in invs)
        counts += Counter(fam.get(r.customer_id, DEFAULT) for r in rets if r.customer_id)

        print(f"فواتير بلا نوع: {len(invs)}   مرتجعات بلا نوع: {len(rets)}\n")
        print("التوزيع المتوقّع:")
        for value, n in counts.most_common():
            print(f"   {value:<10}{n:>7}")

        have = {o.value for o in db.scalars(
            select(LookupOption).where(LookupOption.category == LOOKUP)).all()}
        missing = [v for v in counts if v not in have]
        if missing:
            print(f"\nهيتضاف لقائمة «أنواع حسابات العملاء»: {'، '.join(missing)}")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        order = 0
        for value in missing:
            order += 1
            db.add(LookupOption(category=LOOKUP, value=value, label=value,
                                sort_order=order, active=True, is_system=False))
        for i in invs:
            i.family = fam.get(i.customer_id, DEFAULT)
        for r in rets:
            if r.customer_id:
                r.family = fam.get(r.customer_id, DEFAULT)
        db.commit()
        n_ret = len([r for r in rets if r.customer_id])
        print(f"\nاتحطّ النوع على {len(invs)} فاتورة و{n_ret} مرتجع.")
        print("تم.")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
