"""يصنّف كروت الموظفين اللي اتنقلت من a5 كـ«تجار» — والدليل مرتباتهم في a5 نفسه.

    python -m src.scripts.fix_employee_customer_types          # يعرض بس
    python -m src.scripts.fix_employee_customer_types --yes    # ينفّذ

---------------------------------------------------------------------------
**الحكاية:** صاحب النظام فتح كشف العملاء (فرع العلياء) ولقى ناس هو عارف إنهم
موظفين عنده متصنّفين «تاجر». وهو صح.

**والسبب عندنا مش عند a5.** `import_a5_docs.Ctx.party()` بيخترع كارت عميل لأي طرف
على مستند a5 مش موجود في كشف العملاء بتاعهم، وبيحطّ `customer_type="trader"`
بالكود — قواعد الاسم في `classify_a5_parties` عمرها ما بتشوف الكروت دي. دي سلسلة
`A5X`، ٣١ كارت. والباقي اتصنّف `trader` لأنه التصنيف الافتراضي و`a5` مافيهوش خانة
نوع أصلاً (اتأكدت: تصدير `Cust` عشر أعمدة — رقم، اسم، محافظة، مدينة، مندوب،
عنوان، ثابت، فرع، ثابت، تليفون. ولا واحد فيهم تصنيف).

---------------------------------------------------------------------------
**الدليل: حساب مرتب في شجرة a5.**

دوّرت الأول في **«ذمم الموظفين»** ولقيت ٥١ كارت. بس المجموعة دي عند a5 **عهدة**
مش كشف موظفين: جواها بونصات سيارات، ومندوبيات، وكيانات داخلية، ومحافظ فون كاش،
وأقسام — و٨٤ من ١٤٠ حساب فيها **صفر سطور**، قشور اتفتحت مرة واتنست. فوجود حساب
هناك لوحده إشارة ضعيفة.

**«اجور ومرتبات إدارية» تحسمها.** محدش بيدّي مرتب لتاجر. والمقياس:

    حسابات تحت «اجور ومرتبات إدارية» : ١٥١ حساب · ١٤٤ اسم
    حسابات تحت «ذمم الموظفين»        : ١٤٠ حساب · ١٣٣ اسم

    كروت عملاء ليها حساب مرتب        : ٤٣
    منها ليها كمان حساب ذمم موظفين   : ٤٢   ← الاتنين مع بعض
    متصنّفين «موظف» عندنا دلوقتي     : ١٢

يعني **٣١ كارت** موظف بشهادة دفاتر a5 نفسها، ومتصنّفين تجار عندنا.

⚠️ **سطور المرتبات نفسها صفر عندنا** — قيود المرتبات ماتنقلتش (اتنقل البيع والشرا
والأرصدة الافتتاحية بس). فالدليل هو **وجود الحساب في مجموعة المرتبات**، مش حركته.
ده كافي: a5 مابيفتحش حساب تحت «اجور ومرتبات» لحد مش على كشف المرتب.

---------------------------------------------------------------------------
**تلاتة في القايمة مش أشخاص، وبيتعلّموا «داخلي» مش «موظف»:**

«اداره مبيعات» (كارتين، فرع لكل) و«فرع اكتوبر» — أقسام وفروع. البضاعة الرايحة لهم
صرف داخلي مش بيعة، وتصنيفهم موظف بيحطّ قسم في كشف المرتبات.

**وواحد بيتقال ومابيتغيّرش:** `AL-A5X10` «محمد عبد العال فون كاش» — ٤٩٧ سطر على
حساب عهدته، بس ده **محفظة مش راجل**. مكانه خزنة مش كارت عميل. `trader` غلط
و`employee` غلط برضه، فالسكربت بيطبعه ويسيبه لقرار المكتب.

**و`employee_id` مابيتكتبش.** ٢٦ صف بس في جدول الموظفين مصدرهم a5، وكلهم أكتوبر
(`A5E-*`) — **مرتبات العلياء ماتنقلتش خالص**. فمعظم اللي هنا مالوش صف يترابط بيه،
والتخمين بيحطّ رصيد راجل على مرتب راجل تاني. نقل مرتبات العلياء هو الخطوة اللي بعد
دي.

**مابيتغيّر غير `customer_type`** — ولا فاتورة ولا قيد ولا رصيد ولا ربط حساب.
بيتعاد تشغيله بأمان: اللي وصل تصنيفه بيتخطى.
"""
from __future__ import annotations

import re
import sys
from collections import defaultdict

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.customer import Customer
from src.models.ledger import Account
from src.models.lookup import LookupOption
from src.models.sales import SalesInvoice

PAYROLL_GROUP = "اجور ومرتبات إدارية"
CUSTODY_GROUP = "ذمم الموظفين"

# كود الكارت → الاسم. **بالكود مش بالاسم**: «احمد صلاح» و«أحمد الشحات» بيتكرروا في
# الفرعين بكروت مختلفة، والمطابقة بالاسم هي اللي وقّعتنا في الأول.
#
# القايمة دي **مقيسة**: كل كود هنا كارت اسمه ليه حساب تحت «اجور ومرتبات إدارية» في
# شجرة a5. والسكربت بيعيد القياس قبل ما يكتب — أي كود فقد الشرط بيتقال ويتخطى.
EMPLOYEE_CARDS: dict[str, str] = {
    # ── أكتوبر ──
    "A5-14": "احمد صلاح",
    "A5-146": "عمرو رجب",
    "A5X2": "محمود عادل المنصورة",
    "A5X3": "كامل هلال",
    "A5X4": "سامى دغار",
    "A5X6": "انس رمضان",
    "A5X7": "احمد دسوقى",
    "A5X8": "محمد سعيد الماحى",
    "A5X9": "محمود سلام",
    "A5X10": "عبد الرحمن جمعة",
    # ── العلياء ──
    "AL-A5-197": "احمد الشحات",
    "AL-A5-398": "محمد عزوز",
    "AL-A5-637": "طارق عقبه",
    "AL-A5-667": "مصطفى البحيرى",
    "AL-A5-781": "احمد صلاح",
    "AL-A5-984": "احمد صبرى",
    "AL-A5-3125": "كامل هلول",
    "AL-A5-3188": "محمود النقراشى",
    "AL-A5-4288": "حسن رمضان",
    "AL-A5-4299": "ابراهيم حسونه",
    "AL-A5-4357": "محمود سلام",
    "AL-A5-9675": "محمد سعيد",
    "AL-A5X1": "احمد عسران",
    "AL-A5X5": "محمد حسن",
    "AL-A5X6": "محمد ربيع السقا",
    "AL-A5X7": "مدحت خضر",
    "AL-A5X8": "محمد عسران",
    "AL-A5X11": "محمد مكرم",
    "AL-A5X12": "محمد ممدوح",
    "AL-A5X13": "احمد عبده ناجى هلول",
    "AL-A5X14": "محمد هلال ابو عمه",
    "AL-A5X15": "م سامح هلول",
    "AL-A5X16": "أحمد الشحات",
    "AL-A5X17": "أحمدتركى",
    "AL-A5X18": "محمد عشيبة",
    "AL-A5X19": "ابراهيم حمود",
    "AL-A5X20": "حسام موسي",
    "AL-A5X21": "حسن عيد",
    "AL-A5X22": "احمد منصف زين الدين",
}

# مش أشخاص — أقسام وفروع. البضاعة الرايحة لهم صرف داخلي مش بيعة.
INTERNAL_CARDS: dict[str, str] = {
    "AL-A5-187": "اداره مبيعات",
    "A5-1627": "اداره مبيعات",
    "AL-A5X3": "فرع اكتوبر",
}

# بيتقال ومابيتغيّرش — محفظة فون كاش، مكانها خزنة مش كارت عميل.
FLAGGED: dict[str, str] = {
    "AL-A5X10": "محمد عبد العال فون كاش — محفظة مش راجل، مكانها خزنة",
}


def _norm(s: str) -> str:
    s = re.sub(r"[أإآٱ]", "ا", s or "")
    s = s.replace("ة", "ه").replace("ى", "ي").replace("ـ", "")
    return re.sub(r"\s+", " ", s).strip()


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        groups = {a.id: (a.name or "").strip()
                  for a in db.scalars(select(Account)) if not a.is_postable}
        in_group: dict[str, set[str]] = defaultdict(set)
        for a in db.scalars(select(Account).where(Account.is_postable.is_(True))):
            in_group[groups.get(a.parent_id, "—")].add(_norm(a.name or ""))
        payroll = in_group.get(PAYROLL_GROUP, set())
        custody = in_group.get(CUSTODY_GROUP, set())
        print(f"أسماء تحت «{PAYROLL_GROUP}»: {len(payroll)}   ·   "
              f"تحت «{CUSTODY_GROUP}»: {len(custody)}\n")

        plan: list[tuple[Customer, str, int, bool]] = []
        problems: list[str] = []
        for code, expect_name in list(EMPLOYEE_CARDS.items()) + list(INTERNAL_CARDS.items()):
            want = "employee" if code in EMPLOYEE_CARDS else "internal"
            c = db.scalar(select(Customer).where(Customer.code == code))
            if c is None:
                problems.append(f"{code} «{expect_name}»: الكارت مش موجود")
                continue
            if _norm(c.name) != _norm(expect_name):
                problems.append(f"{code}: الاسم بقى «{c.name}» بدل «{expect_name}» — اتخطّى")
                continue
            # الحارس: الموظف لازم يفضل ليه حساب مرتب. القسم الداخلي معفي — هو مش شخص.
            if want == "employee" and _norm(c.name) not in payroll:
                problems.append(f"{code} «{c.name}»: مالوش حساب مرتب في a5 دلوقتي — اتخطّى")
                continue
            if c.customer_type == want:
                continue
            n = db.scalar(select(func.count()).select_from(SalesInvoice)
                          .where(SalesInvoice.customer_id == c.id)) or 0
            plan.append((c, want, n, _norm(c.name) in custody))

        print(f"{'الكود':<13}{'الاسم':<26}{'من':<11}{'إلى':<11}{'فواتير':>7}{'عهدة'}")
        print("-" * 76)
        for c, want, n, has_cust in sorted(plan, key=lambda r: (r[1], -r[2])):
            print(f"{(c.code or ''):<13}{(c.name or '')[:24]:<26}"
                  f"{str(c.customer_type):<11}{want:<11}{n:>7}{'   ✔' if has_cust else ''}")
        emp_n = sum(1 for _c, w, _n, _h in plan if w == "employee")
        print(f"\nهيتصنّفوا «موظف»: {emp_n}   ·   «داخلي»: {len(plan) - emp_n}")

        if FLAGGED:
            print("\n⚠️ بيتقالوا ومابيتغيّروش — محتاجين قرار:")
            for code, why in FLAGGED.items():
                c = db.scalar(select(Customer).where(Customer.code == code))
                if c is not None:
                    print(f"   {code:<12}{why}   (دلوقتي «{c.customer_type}»)")

        # اللي ليه حساب مرتب ومش في الخريطة — الصورة تفضل كاملة قبل التنفيذ.
        known = set(EMPLOYEE_CARDS) | set(INTERNAL_CARDS) | set(FLAGGED)
        missed = [c for c in db.scalars(select(Customer).where(Customer.active.is_(True)))
                  if _norm(c.name) in payroll and c.code not in known
                  and c.customer_type not in ("employee", "internal")]
        if missed:
            print(f"\n⚠️ ليهم حساب مرتب ومش في الخريطة ({len(missed)}):")
            for c in missed:
                print(f"   {c.code:<13}{c.name}   («{c.customer_type}»)")

        if problems:
            print(f"\n⚠️ مش هيتغيّروا ({len(problems)}):")
            for p in problems:
                print(f"   {p}")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for value, label in (("employee", "موظف"), ("internal", "فرع/شركة تابعة")):
            if not db.scalar(select(LookupOption).where(
                    LookupOption.category == "customer_type",
                    LookupOption.value == value)):
                db.add(LookupOption(category="customer_type", value=value,
                                    label=label, active=True))
        for c, want, _n, _h in plan:
            c.customer_type = want
        db.commit()

        print(f"\n✔ اتغيّر تصنيف {len(plan)} كارت.")
        for v in ("employee", "internal", "trader"):
            n = db.scalar(select(func.count()).select_from(Customer)
                          .where(Customer.active.is_(True),
                                 Customer.customer_type == v)) or 0
            print(f"   {v:<12}{n:>6}")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
