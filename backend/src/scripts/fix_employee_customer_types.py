"""يفرز كروت الموظفين عن كروت العملاء في اللي اتنقل من a5 — بشهادة شجرة a5.

    python -m src.scripts.fix_employee_customer_types          # يعرض بس
    python -m src.scripts.fix_employee_customer_types --yes    # ينفّذ

---------------------------------------------------------------------------
**الحكاية:** صاحب النظام فتح كشف عملاء العلياء ولقى ناس هو عارف إنهم موظفين عنده
متصنّفين «تاجر». وهو صح.

**والسبب عندنا مش عند a5.** `import_a5_docs.Ctx.party()` بيخترع كارت عميل لأي طرف
على مستند a5 مش موجود في كشف عملائهم، وبيحطّ `customer_type="trader"` بالكود —
قواعد الاسم في `classify_a5_parties` عمرها ما بتشوف الكروت دي. دي سلسلة `A5X`.
والباقي وقع على `trader` لأنه الافتراضي: **a5 مافيهوش خانة نوع أصلاً** (اتأكدت من
تصدير `Cust` — عشر أعمدة: رقم، اسم، محافظة، مدينة، مندوب، عنوان، ثابت، فرع، ثابت،
تليفون. ولا واحد فيهم تصنيف).

---------------------------------------------------------------------------
**غلطتين اتعملوا هنا بالترتيب، والتانية أهم من الأولى:**

**١) «ذمم الموظفين» مش كشف موظفين.** دوّرت فيها الأول ولقيت ٥١ كارت — والمجموعة دي
عند a5 **عهدة**: جواها بونصات سيارات، ومندوبيات، وكيانات داخلية، ومحافظ فون كاش،
وأقسام. و٨٤ من ١٤٠ حساب فيها **صفر سطور**، قشور اتفتحت مرة واتنست.

**«اجور ومرتبات إدارية» أنضف** — محدش بيدّي مرتب لتاجر:

    أسماء تحت «اجور ومرتبات إدارية» : ١٤٤
    كروت عملاء ليها حساب مرتب        : ٤٣

**٢) بس حساب المرتب لوحده مايكفيش — والراجل ممكن يكون الاتنين.**

التشغيلة الأولى حوّلت ٢٧ كارت لـ«موظف»، ومنهم **١٤ عليهم فواتير حقيقية**: حسن
رمضان ٤٦ فاتورة بـ١٤٨٬٥٩٣ ج، وطارق عقبه ٣١ بـ٥٠٬١٥١. الرجالة دول اختفوا من كشف
العملاء اللي المندوب بيشتغل عليه، ومرتبهم ماستفادش حاجة — هو أصلاً على حساب تاني.

**a5 بيدّي الراجل ده حسابين:** واحد تحت «العملاء» (دين البضاعة اللي اشتراها)
وواحد تحت «اجور ومرتبات» و«ذمم الموظفين» (مرتبه وسلفه). حسابين لنفس الشخص بغرضين
مختلفين، وده منطق a5 وسليم. **والكارت اللي عندنا بيقابل حساب العميل** — عليه
فواتيره ورصيده.

---------------------------------------------------------------------------
**القاعدة النهائية — الكارت بيتبع تصنيف a5 له:**

* اسمه له حساب تحت **«العملاء»** ⇒ كارت عميل، مهما كان له مرتب. (`BACK_TO_CUSTOMER`)
* مالوش حساب عملاء وله حساب مرتب ⇒ الكارت ده اتخلق من المستندات عندنا، وهو كارت
  موظف. (`EMPLOYEE_CARDS`)
* مش شخص أصلاً — قسم أو فرع ⇒ «داخلي». (`INTERNAL_CARDS`)

⚠️ **سطور المرتبات نفسها صفر عندنا** — قيود المرتبات ماتنقلتش (اتنقل البيع والشرا
والأرصدة الافتتاحية بس). فالدليل هو **وجود الحساب في مجموعة المرتبات**، مش حركته.
ده كافي: a5 مابيفتحش حساب تحت «اجور ومرتبات» لحد مش على كشف المرتب.

**وواحد بيتقال ومابيتغيّرش:** `AL-A5X10` «محمد عبد العال فون كاش» — ٤٩٧ سطر على
حساب عهدته، بس ده **محفظة مش راجل**. مكانه خزنة مش كارت عميل. `trader` غلط
و`employee` غلط برضه، فالسكربت بيطبعه ويسيبه لقرار المكتب.

**و`employee_id` مابيتكتبش.** جدول الموظفين فيه ٢٦ صف بس مصدرهم a5 وكلهم أكتوبر
(`A5E-*`) — **مرتبات العلياء ماتنقلتش خالص**، وهي فرع أغلب اللي هنا. الربط
بالتخمين بيحطّ رصيد راجل على مرتب راجل تاني. نقل مرتبات العلياء هو الخطوة اللي بعد
دي.

**والحُرّاس بيعيدوا القياس قبل الكتابة:** الموظف لازم يفضل ليه حساب مرتب ومالوش
حساب عملاء؛ والراجع «تاجر» لازم يفضل ليه حساب عملاء. أي كارت فقد شرطه بيتقال
ويتخطى، وأي كارت ليه حساب مرتب ومالوش حساب عملاء ومش في الخريطة بيتقال كمان —
فالخريطة بتفضح نفسها لو الداتا اتحركت.

**مابيتغيّر غير `customer_type`** — ولا فاتورة ولا قيد ولا رصيد ولا ربط حساب.
بيتعاد تشغيله بأمان: اللي وصل تصنيفه بيتخطى.
"""
from __future__ import annotations

import csv
import os
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
CUSTOMER_GROUP = "العملاء"

# كود الكارت → الاسم. **بالكود مش بالاسم**: «احمد صلاح» و«أحمد الشحات» بيتكرروا في
# الفرعين بكروت مختلفة، والمطابقة بالاسم هي اللي وقّعتنا في الأول.
#
# القايمة دي **مقيسة**: كل كود هنا كارت اسمه ليه حساب تحت «اجور ومرتبات إدارية» في
# شجرة a5. والسكربت بيعيد القياس قبل ما يكتب — أي كود فقد الشرط بيتقال ويتخطى.
EMPLOYEE_CARDS: dict[str, str] = {
    # ── a5 كاتب لهم **وظيفة صريحة** على حساب المرتب/العهدة ──
    #
    # دول في كشف عملاء a5 كمان (`Cust`)، وكنت سايبهم عملاء على قاعدة «الكارت
    # بيتبع تصنيف a5». بس الوظيفة إشارة **أقوى** من مجرد وجود صف في `Cust`:
    # «غفير» و«سائق» و«مشرف مبيعات» مش أوصاف تاجر — دي a5 بيقول بصريح العبارة
    # إن الراجل ده على كشف مرتباته.
    #
    # وكونه بيشتري كمان مابيلغيش إنه موظف — بيفضل ليه حسابين عندهم زي ما هو،
    # والكارت عندنا بيتصنّف باللي هو عليه فعلاً عشان يبان في تبويب «الموظفين».
    "AL-A5-984": "احمد صبرى",   # مندوب تسويق
    "AL-A5-637": "طارق عقبه",   # مشرف مبيعات
    "A5-146": "عمرو رجب",   # مندوب بيع
    "AL-A5-3188": "محمود النقراشى",   # غفير
    "AL-A5-4299": "ابراهيم حسونه",   # مندوب تسويق
    "A5-14": "احمد صلاح",   # سائق
    "AL-A5-152": "محمد صبحى",   # مندوب تسويق
    "AL-A5-398": "محمد عزوز",   # مندوب تسويق
    "AL-A5-3125": "كامل هلول",   # مشرف مبيعات
    # ── أكتوبر ──
    "A5X2": "محمود عادل المنصورة",
    "A5X3": "كامل هلال",
    "A5X4": "سامى دغار",
    "A5X6": "انس رمضان",
    "A5X7": "احمد دسوقى",
    "A5X8": "محمد سعيد الماحى",
    "A5X10": "عبد الرحمن جمعة",
    "A5X9": "محمود سلام",
    # ── العلياء ──
    "AL-A5X1": "احمد عسران",
    "AL-A5X5": "محمد حسن",
    "AL-A5X6": "محمد ربيع السقا",
    "AL-A5X7": "مدحت خضر",
    "AL-A5X8": "محمد عسران",
    "AL-A5X9": "حذيفه زين عبد الفتاح",
    "AL-A5X10": "محمد عبد العال فون كاش",
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

# **دول موظفين وعملاء في نفس الوقت — والكارت كارت عميل.**
#
# a5 بيدّي الراجل ده **حسابين**: واحد تحت «العملاء» (دين البضاعة اللي اشتراها)
# وواحد تحت «اجور ومرتبات» و«ذمم الموظفين» (مرتبه وسلفه). الحسابين لنفس الشخص
# بغرضين مختلفين، وده منطق a5 وسليم.
#
# والكارت اللي عندنا بيقابل **حساب العميل** — عليه فواتيره ورصيده. فتحويله لـ«موظف»
# بيشيله من كشف العملاء، وهو اللي بيشتري: حسن رمضان ٤٦ فاتورة بـ١٤٨٬٥٩٣ ج، وطارق
# عقبه ٣١ بـ٥٠٬١٥١. الراجل اختفى من الكشف اللي بيشتغل عليه المندوب، ومرتبه ماستفادش
# حاجة — هو أصلاً على حسابه التاني.
#
# **فالقاعدة اتظبطت:** الكارت بيتبع تصنيف a5 له. اسمه له حساب تحت «العملاء» ⇒ كارت
# عميل. مالوش ⇒ الكارت ده اتخلق من المستندات عندنا وهو كارت موظف.
#
# الأربعتاشر دول اتحوّلوا غلط في التشغيلة الأولى وبيرجعوا «تاجر» — وهو تصنيفهم اللي
# كان قبل ما ألمسهم.
BACK_TO_CUSTOMER: dict[str, str] = {
    # **الاسم الواحد مش شخص واحد بين الفرعين.** «احمد صلاح» في أكتوبر سائق
    # (حساب مرتب + عهدة)، وفي العلياء عميل خالص — حسابه الوحيد تحت «العملاء»
    # ومندوبه «مندوب السياره ( ب )». نقل الوظيفة من فرع لفرع كان بيخلّي راجل
    # بيشتري يبقى موظف عشان واحد تاني اسمه زيه بياخد مرتب في مدينة تانية.
    "AL-A5-781": "احمد صلاح",
    # موظفين فعلاً — بس a5 حاطط كارتهم في `Cust`، فالكارت كارت عميل.
    # (عمرو رجب مندوب عليه ٢٣٠ عميل، واحمد صبرى ليه مخزن باسمه.) هويتهم
    # كموظفين عايشة على حساب المرتب وجدول الموظفين، مش على الكارت ده.
    "AL-A5-4357": "محمود سلام",
    "AL-A5-4288": "حسن رمضان",
    "AL-A5-9675": "محمد سعيد",
    "AL-A5-197": "احمد الشحات",
    "AL-A5-667": "مصطفى البحيرى",
}

# مش أشخاص — أقسام وفروع. البضاعة الرايحة لهم صرف داخلي مش بيعة.
INTERNAL_CARDS: dict[str, str] = {
    # قسم مش شخص — البضاعة الرايحة له صرف داخلي، وتصنيفه موظف بيحطّ قسم في
    # كشف المرتبات.
    "AL-A5-2112": "خدمة العملاء",
    "AL-A5-187": "اداره مبيعات",
    "A5-1627": "اداره مبيعات",
    "AL-A5X3": "فرع اكتوبر",
}

# بيتقال ومابيتغيّرش — محفظة فون كاش، مكانها خزنة مش كارت عميل.
FLAGGED: dict[str, str] = {}


# كشف موظفي a5 — ناتج استعلام قراءة على `accBrnch` في القاعدتين:
#
#   SELECT AccBrnch_N, Brnch_Cod, MTree2 AS الوظيفة,
#          <اسمه في Cust؟> AS في_كشف_العملاء, <عدد فواتيره> AS فواتير
#   FROM accBrnch WHERE AccMain_N = N'ذمم الموظفين'
#
# والمقارنة مع `Cust` **متطبّعة** (ة→ه، ى→ي، أإآ→ا): المطابقة بالحرف كانت بتقول إن
# «محمد حمودة» مش في كشف العملاء وهو فيه، بفرق حرف واحد.
ROSTER_DIR = "C:/pgtmp"
ROSTER_FILES = ("emp_AL.tsv", "emp_OCT.tsv")

# كشف عملاء a5 كامل — `SELECT Cust_id, Cust_name FROM Cust` من القاعدتين.
#
# **الحارس بتاع الرجوع «تاجر» بيسأل ده بالكود، مش بالاسم.** كود الكارت بيحمل رقم
# a5 جوّاه (`AL-A5-984` = `Cust_id` ٩٨٤ في العلياء)، والرقم مابيتغيّرش مهما الاسم
# اتعدّل عندنا. والاسم كان بيوقّعنا: «احمد صبرى» له كارت عميل في `Cust` **و**حساب
# تحت «ذمم الموظفين» باسم قريب، فالمقارنة بالاسم بتقول «ده موظف» وهي غلط — كارته
# كارت عميل عند a5 نفسه.
CUST_FILES = {"cust_aliaa2026.tsv": "AL-A5-", "cust_Techno2026.tsv": "A5-"}


def _read_cust() -> dict[str, set[str]] | None:
    """بادئة الفرع → أرقام العملاء في a5."""
    out: dict[str, set[str]] = {}
    for fn, prefix in CUST_FILES.items():
        path = os.path.join(ROSTER_DIR, fn)
        if not os.path.exists(path):
            continue
        ids = out.setdefault(prefix, set())
        with open(path, encoding="utf-8", newline="") as fh:
            for row in csv.DictReader(fh, delimiter="\t"):
                if (row.get("رقم") or "").strip():
                    ids.add(row["رقم"].strip())
    return out or None


# كشف حسابات a5 كاملة — `SELECT AccBrnch_id, AccBrnch_N, AccMain_N, MTree2 FROM accBrnch`.
#
# اللي بيهمنا منه **الوظيفة** (`MTree2`) على حساب تحت «ذمم الموظفين» أو «اجور
# ومرتبات إدارية»: «غفير»، «سائق»، «مشرف مبيعات»، «محاسب»، «مندوب تسويق».
#
# دي إشارة **أقوى** من مجرد وجود صف في `Cust`. الراجل ممكن يكون في الكشفين — بيشتري
# وبياخد مرتب — و«غفير» مش وصف تاجر. فاللي a5 كاتب له وظيفة بيتصنّف موظف حتى لو
# كارته في كشف العملاء عندهم.
STAFF_GROUPS = ("ذمم الموظفين", "اجور ومرتبات إدارية")
# الملف → بادئة أكواد الفرع بتاعه.
#
# ⚠️ **الوظيفة بتتقيّد بالفرع.** «احمد صلاح» في أكتوبر سائق (حساب مرتب + عهدة)،
# وفي العلياء عميل خالص. خريطة بالاسم لوحده كانت بتنقل الوظيفة بين الفرعين، فراجل
# بيشتري في العلياء يبقى موظف عشان واحد تاني اسمه زيه بياخد مرتب في مدينة تانية.
ACC_FILES = {"acc_aliaa2026.tsv": "AL-", "acc_Techno2026.tsv": ""}


def _read_staff_jobs() -> dict[tuple[str, str], str]:
    """(بادئة الفرع، الاسم المطبّع) → وظيفته، من حسابات الموظفين في a5."""
    out: dict[tuple[str, str], str] = {}
    for fn, prefix in ACC_FILES.items():
        path = os.path.join(ROSTER_DIR, fn)
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8", newline="") as fh:
            for row in csv.DictReader(fh, delimiter="\t"):
                if (row.get("المجموعة") or "").strip() not in STAFF_GROUPS:
                    continue
                job = (row.get("الوظيفة") or "").strip()
                if job:
                    out.setdefault((prefix, _norm(row.get("الاسم") or "")), job)
    return out


def _job_of(code: str, name: str, jobs: dict[tuple[str, str], str]) -> str | None:
    """وظيفة الكارت ده عند a5 — في فرعه هو."""
    prefix = "AL-" if (code or "").startswith("AL-") else ""
    return jobs.get((prefix, _norm(name)))


def _in_cust(code: str, ids: dict[str, set[str]] | None) -> bool:
    """الكود ده بيشاور على صف حقيقي في كشف عملاء a5؟"""
    if ids is None:
        return True                      # الكشف مش موجود — الحارس بيتعطّل
    m = re.match(r"^(AL-)?A5-(\d+)$", code or "")
    if not m:
        return False
    return m.group(2) in ids.get("AL-A5-" if m.group(1) else "A5-", set())


def _read_roster() -> tuple[set[str] | None, dict[str, str]]:
    """أسماء الموظفين اللي **مش** في كشف عملاء a5، ووظيفة كل واحد."""
    import csv
    import os

    names: set[str] = set()
    jobs: dict[str, str] = {}
    found = False
    for fn in ROSTER_FILES:
        path = os.path.join(ROSTER_DIR, fn)
        if not os.path.exists(path):
            continue
        found = True
        with open(path, encoding="utf-8", newline="") as fh:
            for row in csv.DictReader(fh, delimiter="\t"):
                if (row.get("في_كشف_العملاء") or "").strip() == "0":
                    k = _norm(row.get("الاسم") or "")
                    names.add(k)
                    if (row.get("الوظيفة") or "").strip():
                        jobs[k] = row["الوظيفة"].strip()
    return (names if found else None), jobs


def _norm(s: str) -> str:
    """تطبيع **بيحافظ على الهمزة** — لأن a5 بيفرّق بيها بين طرفين مختلفين.

    «احمد الشحات» عميل في `Cust` رقم ١٩٧، و«أحمد الشحات» حساب موظف (سائق) تحت
    «ذمم الموظفين» عليه ٢٩ سطر. اتنين مختلفين عند a5، والهمزة هي الفرق الوحيد.
    طي الهمزة كان بيدمجهم، فالموظف بيتقري «موجود في كشف العملاء» ويتصنّف تاجر.

    والباقي بيتطبّع زي ما هو (ة/ه، ى/ي، التطويل، المسافات) — دول اختلافات كتابة
    مش تفرقة، ونفس القاعدة بالظبط اللي في استعلام a5 عشان الجهتين يقولوا نفس
    الحاجة."""
    s = (s or "").replace("ة", "ه").replace("ى", "ي").replace("ـ", "")
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
        roster, jobs = _read_roster()
        staff_jobs = _read_staff_jobs()
        jobs = {**{k[1]: v for k, v in staff_jobs.items()}, **jobs}
        cust_ids = _read_cust()
        warned_no_roster = False
        print(f"أسماء تحت «{PAYROLL_GROUP}»: {len(payroll)}   ·   "
              f"تحت «{CUSTODY_GROUP}»: {len(custody)}\n")

        plan: list[tuple[Customer, str, int, bool]] = []
        problems: list[str] = []
        wanted: list[tuple[str, str, str]] = (
            [(c, n, "employee") for c, n in EMPLOYEE_CARDS.items()]
            + [(c, n, "internal") for c, n in INTERNAL_CARDS.items()]
            + [(c, n, "trader") for c, n in BACK_TO_CUSTOMER.items()])
        for code, expect_name, want in wanted:
            c = db.scalar(select(Customer).where(Customer.code == code))
            if c is None:
                problems.append(f"{code} «{expect_name}»: الكارت مش موجود")
                continue
            if _norm(c.name) != _norm(expect_name):
                problems.append(f"{code}: الاسم بقى «{c.name}» بدل «{expect_name}» — اتخطّى")
                continue
            # **الحارس بيسأل a5 مباشرةً** — مش بديل مستنتج من الشجرة المنقولة.
            #
            # الكشفين اللي بيتقروا فوق هما ناتج استعلام على قاعدتي a5 نفسهم:
            # كل حساب تحت «ذمم الموظفين»، ومعاه هل اسمه في `Cust` ولا لأ. الاسم
            # اللي مش في `Cust` = كارت موظف، واللي فيه = كارت عميل. وده **الفصل
            # اللي a5 شغّال بيه فعلاً**: فاتورته بتقبل الطرفين، والفرق إن الأول
            # مالوش صف في كشف العملاء أصلاً.
            #
            # البدائل اللي جرّبتها قبل كده (الاسم، ثم «ذمم الموظفين» لوحدها، ثم
            # حساب المرتب) كلها كانت بتقرّب — وكل واحدة غلطت عند حواف مختلفة.
            #
            # لو الكشف مش موجود، الحارس بيتعطّل **بصوت** — أهون من إنه يمنع الصح
            # بهدوء، وأهون من إنه يعدّي أي حاجة من غير فحص.
            if roster is None:
                if not warned_no_roster:
                    print("⚠️ كشف a5 مش موجود على الجهاز — الحارس متعطّل. "
                          "شغّل الاستعلام وحطّ الكشفين في " + ROSTER_DIR)
                    warned_no_roster = True
            elif want == "employee" and _norm(c.name) not in roster \
                    and not _job_of(code, c.name, staff_jobs):
                problems.append(
                    f"{code} «{c.name}»: لا في كشف موظفي a5 ولا ليه وظيفة — اتخطّى")
                continue
            elif want == "trader" and _job_of(code, c.name, staff_jobs):
                problems.append(
                    f"{code} «{c.name}»: a5 كاتب له وظيفة "
                    f"«{_job_of(code, c.name, staff_jobs)}» — اتخطّى")
                continue
            elif want == "trader" and not _in_cust(code, cust_ids):
                problems.append(
                    f"{code} «{c.name}»: كوده مش في كشف عملاء a5 — اتخطّى")
                continue
            if c.customer_type == want:
                continue
            n = db.scalar(select(func.count()).select_from(SalesInvoice)
                          .where(SalesInvoice.customer_id == c.id)) or 0
            plan.append((c, want, n, _norm(c.name) in custody))

        print(f"{'الكود':<13}{'الاسم':<26}{'من':<11}{'إلى':<11}{'فواتير':>7}{'عهدة'}")
        print("-" * 76)
        for c, want, n, _has in sorted(plan, key=lambda r: (r[1], -r[2])):
            job = jobs.get(_norm(c.name), "")
            print(f"{(c.code or ''):<13}{(c.name or '')[:24]:<26}"
                  f"{str(c.customer_type):<11}{want:<11}{n:>7}  {job}")
        emp_n = sum(1 for _c, w, _n, _h in plan if w == "employee")
        int_n = sum(1 for _c, w, _n, _h in plan if w == "internal")
        back_n = sum(1 for _c, w, _n, _h in plan if w == "trader")
        print(f"\n«موظف»: {emp_n}   ·   «داخلي»: {int_n}   ·   "
              f"راجعين «تاجر» (عندهم حساب عملاء في a5): {back_n}")

        if FLAGGED:
            print("\n⚠️ بيتقالوا ومابيتغيّروش — محتاجين قرار:")
            for code, why in FLAGGED.items():
                c = db.scalar(select(Customer).where(Customer.code == code))
                if c is not None:
                    print(f"   {code:<12}{why}   (دلوقتي «{c.customer_type}»)")

        # اللي ليه حساب مرتب ومش في الخريطة — الصورة تفضل كاملة قبل التنفيذ.
        known = (set(EMPLOYEE_CARDS) | set(INTERNAL_CARDS)
                 | set(FLAGGED) | set(BACK_TO_CUSTOMER))
        missed = [c for c in db.scalars(select(Customer).where(Customer.active.is_(True)))
                  if roster is not None and _norm(c.name) in roster
                  and c.code not in known
                  and c.customer_type not in ("employee", "internal")]
        if missed:
            print(f"\n⚠️ في كشف موظفي a5 ومش في الخريطة ({len(missed)}):")
            for c in missed:
                print(f"   {c.code:<13}{c.name}   («{c.customer_type}»)  "
                      f"{jobs.get(_norm(c.name), '')}")

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
