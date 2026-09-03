"""ينقل موظفي a5 اللي مالهمش كارت عندنا — عشان نقدر نعملهم فاتورة زي ما a5 بيعمل.

    python -m src.scripts.import_a5_employee_cards          # يعرض بس
    python -m src.scripts.import_a5_employee_cards --yes    # ينفّذ

---------------------------------------------------------------------------
**ليه:** فاتورة a5 بتقبل طرف مش في كشف العملاء أصلاً — ٢١٦ فاتورة في العلياء
كده. والأطراف دي تحت **«ذمم الموظفين»** في `accBrnch`، ومعاها وظايفها في العمود
`MTree2` (سائق، محاسب، سكرتارية، غفير، مندوب تسويق، مسئول مخازن، المدير العام).

النقل الأصلي ماخلقش كارت غير للّي ظهر على مستند (`import_a5_docs.Ctx.party`)،
فـ٩٦ موظف مالهمش كارت عندنا خالص: a5 يقدر يعملهم فاتورة واحنا لأ.

**المصدر كشف مقروء من a5 مباشرةً** — استعلام `SELECT` على `accBrnch` في القاعدتين
(`aliaa2026` و`Techno2026`)، بيرجّع لكل حساب تحت «ذمم الموظفين»: الاسم، كود
الحساب، الوظيفة، وهل اسمه في `Cust`، وكام فاتورة عليه. الكشفين بيتحطّوا في
`C:/pgtmp`. ⚠️ القاعدتين **قراءة بس** — مافيش سطر واحد بيتكتب هناك.

---------------------------------------------------------------------------
**أربع قرارات:**

* **اللي في `Cust` مابيتلمسش.** ده كارت عميل عند a5 نفسه، حتى لو له مرتب — الراجل
  ممكن يكون موظف وعميل، وa5 بيديله حسابين لغرضين. الكارت عندنا بيقابل حساب العميل.

* **الحساب بيتربط، مش بيتعمل جديد.** حساب «ذمم الموظفين» بتاعه موجود في الشجرة
  المنقولة، وعليه رصيده الحقيقي. الربط بيه معناه إن فاتورته بتترحّل على نفس الحساب
  اللي a5 بيرحّل عليه، وكشف حسابه بيقرا صح من أول يوم. كارت من غير حساب بيبان
  برصيد صفر وهو مديون فعلاً.

* **الوظيفة بتتكتب في العنوان.** مافيش خانة وظيفة على كارت العميل، والوظيفة معلومة
  حقيقية جاية من a5 — فبتتسجّل في `address` مع سطر بيقول إن الكارت منقول. أهون من
  إنها تضيع، وأهون من إني أضيف عمود لحاجة مكانها الطبيعي جدول الموظفين.

* **الكود من كود حساب a5** (`A5E-02200083`)، مش عدّاد. الكود ده ثابت عندهم، فإعادة
  التشغيل بتلاقي الكارت موجود وتتخطاه — وأي مراجعة بعدين تقدر ترجع للحساب الأصلي.

**بيتعاد تشغيله بأمان:** الكارت اللي كوده موجود بيتخطى، والاسم اللي ليه كارت في نفس
الفرع بيتخطى كمان (عشان مانعملش نسخة تانية لواحد كارته اتعمل من مستند).
"""
from __future__ import annotations

import csv
import os
import re
import sys

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.customer import Customer, CustomerAccount
from src.models.ledger import Account
from src.models.org import Branch, Territory
from src.models.user import User

ROSTER_DIR = "C:/pgtmp"
# الملف → (اسم الفرع، بادئة الكود).
#
# **البادئة مش زينة:** كود الحساب في a5 (`Brnch_Cod`) فريد **جوّه القاعدة الواحدة
# بس** — `02200068` موجود في العلياء وفي أكتوبر لاتنين مختلفين. من غير البادئة
# كنا هنخسر واحد منهم بصمت («الكود متكرر») ونفتكر إن الكشف كده.
ROSTER = {
    "emp_AL.tsv": ("العلياء", "AL-A5E-"),
    "emp_OCT.tsv": ("أكتوبر", "A5E-"),
}

# أسماء مش أشخاص — حسابات عهدة لمندوب أو لقسم، مش موظف يتعملّه فاتورة.
NOT_A_PERSON = re.compile(
    r"^\s*(مندوب\s*(ال)?سيار[هة]|مندوب\s*سياره|ادار[هة]|إدار[هة]|بونص|صندوق|خزين[هة]|"
    r"عهد[هة]|مخزن|فرع)\b")

# اسم فيه حرفين عربي على الأقل. الكشف فيه خربوشة كيبورد («,hgjt») و«@@» — دي حسابات
# اتفتحت بالغلط عندهم، ونقلها بيدّي كروت مالهاش معنى في كشف بيتقري كل يوم.
HAS_ARABIC = re.compile(r"[\u0621-\u064a]{2,}")

# رقم الحساب عند a5 — المفتاح الأساسي، وهو الفريد الحقيقي.
ACC_ID = re.compile(r"^\d{1,9}$")
CUSTODY_GROUP = "ذمم الموظفين"
NOTE = "كارت موظف منقول من a5"


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


def _read() -> list[dict]:
    rows: list[dict] = []
    for fn, (branch, prefix) in ROSTER.items():
        path = os.path.join(ROSTER_DIR, fn)
        if not os.path.exists(path):
            print(f"⚠️ الكشف مش موجود: {path}")
            continue
        with open(path, encoding="utf-8", newline="") as fh:
            for r in csv.DictReader(fh, delimiter="\t"):
                # اللي في كشف عملاء a5 كارته كارت عميل — مش شغلنا هنا.
                if (r.get("في_كشف_العملاء") or "").strip() != "0":
                    continue
                name = (r.get("الاسم") or "").strip()
                if not name:
                    continue
                rows.append({
                    "branch": branch, "prefix": prefix, "name": name,
                    "acc_code": (r.get("كود_الحساب") or "").strip(),
                    "acc_id": (r.get("رقم_الحساب") or "").strip(),
                    "job": (r.get("الوظيفة") or "").strip(),
                    "inv": int((r.get("فواتير") or "0") or 0),
                })
    return rows


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        rows = _read()
        if not rows:
            print("مافيش كشف — شغّل الاستعلام الأول.")
            return
        print(f"موظفين في كشف a5 (مش في كشف العملاء): {len(rows)}\n")

        branches = {b.name: b for b in db.scalars(select(Branch))}
        codes = {c.code for c in db.scalars(select(Customer))}
        by_name: dict[tuple[int | None, str], Customer] = {}
        for c in db.scalars(select(Customer)):
            by_name[(c.branch_id, _norm(c.name))] = c

        # حسابات «ذمم الموظفين» في الشجرة المنقولة، بالكود — الكود هو اللي بيربط
        # بأمان، والاسم بيتكرر بين الفرعين.
        groups = {a.id for a in db.scalars(select(Account))
                  if not a.is_postable and (a.name or "").strip() == CUSTODY_GROUP}
        acc_by_code: dict[str, Account] = {}
        acc_by_name: dict[str, list[Account]] = {}
        for a in db.scalars(select(Account).where(Account.parent_id.in_(groups))):
            if a.code:
                acc_by_code[a.code.strip()] = a
            acc_by_name.setdefault(_norm(a.name or ""), []).append(a)
        taken = {x.account_id for x in db.scalars(select(CustomerAccount))}

        plan: list[tuple[dict, Branch, str, Account | None]] = []
        skip_exists: list[str] = []
        junk: list[str] = []
        problems: list[str] = []
        for r in rows:
            br = branches.get(r["branch"])
            if br is None:
                problems.append(f"«{r['name']}»: فرع «{r['branch']}» مش موجود")
                continue
            if (br.id, _norm(r["name"])) in by_name:
                skip_exists.append(f"{r['branch']} · {r['name']}")
                continue
            if not HAS_ARABIC.search(r["name"]):
                junk.append(f"{r['branch']} · «{r['name']}» — مش اسم")
                continue
            if NOT_A_PERSON.match(r["name"]):
                junk.append(f"{r['branch']} · «{r['name']}» — حساب عهدة مش موظف")
                continue
            # **الكود من `AccBrnch_id` مش `Brnch_Cod`.** كود الحساب المعروض عندهم
            # مش فريد حتى جوّه القاعدة الواحدة — `02200068` في العلياء لاتنين
            # مختلفين. والاعتماد عليه كان بيرمي سبعة موظفين حقيقيين بحجة «متكرر».
            # `AccBrnch_id` هو المفتاح الأساسي عندهم، وفريد بجد.
            if not ACC_ID.match(r["acc_id"]):
                junk.append(f"{r['branch']} · «{r['name']}» — رقم الحساب «"
                            f"{r['acc_id']}» مش رقم")
                continue
            code = f"{r['prefix']}{r['acc_id']}"
            if code in codes:
                problems.append(f"«{r['name']}»: الكود «{code}» متكرر")
                continue
            codes.add(code)
            acc = acc_by_code.get(r["acc_code"])
            if acc is None:
                hits = [a for a in acc_by_name.get(_norm(r["name"]), [])
                        if a.id not in taken]
                acc = hits[0] if len(hits) == 1 else None
            if acc is not None:
                taken.add(acc.id)
            plan.append((r, br, code, acc))

        print(f"{'الفرع':<9}{'الاسم':<26}{'الكود':<16}{'الوظيفة':<14}{'فوات':>5}  الحساب")
        print("-" * 92)
        for r, br, code, acc in sorted(plan, key=lambda x: (-x[0]["inv"], x[0]["name"])):
            print(f"{br.name:<9}{r['name'][:24]:<26}{code:<16}"
                  f"{(r['job'] or '—'):<14}{r['inv']:>5}  "
                  f"{acc.code if acc else '— مالوش —'}")
        linked = sum(1 for _r, _b, _c, a in plan if a is not None)
        print(f"\nهيتعمل: {len(plan)} كارت   ·   منهم مربوط بحسابه: {linked}")
        print(f"موجودين خلاص (كارتهم اتعمل من مستند): {len(skip_exists)}")
        if junk:
            print(f"\nاتخطّوا — مش موظفين ({len(junk)}):")
            for j in junk:
                print(f"   {j}")
        if problems:
            print(f"\n⚠️ مش هيتعملوا ({len(problems)}):")
            for p in problems[:12]:
                print(f"   {p}")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        rep = db.scalars(select(User).order_by(User.id)).first()
        terr = db.scalars(select(Territory).order_by(Territory.id)).first()
        if rep is None or terr is None:
            print("✘ مافيش مستخدم أو منطقة — الكارت محتاجهم.")
            return

        made = 0
        for r, br, code, acc in plan:
            note = NOTE + (f" — {r['job']}" if r["job"] else "")
            c = Customer(code=code, name=r["name"], customer_type="employee",
                         rep_id=rep.id, territory_id=terr.id, branch_id=br.id,
                         address=note[:240], active=True)
            db.add(c)
            db.flush()
            if acc is not None:
                db.add(CustomerAccount(customer_id=c.id, account_id=acc.id))
            made += 1
        db.commit()

        # ── الجولة التانية: ربط اللي فضل من غير حساب، بالفرع ──
        #
        # الربط بالاسم لوحده بيقف لما يبقى فيه أكتر من حساب بنفس الاسم — و«مدحت
        # البحيرى» ليه حساب في كل فرع. الوقفة دي **صح**: التخمين هنا بيحطّ رصيد
        # راجل على حساب راجل تاني.
        #
        # بس الفرع بيحسمها. كود الحساب في شجرتنا بيحمل بادئة الفرع (`AL-A5S-` /
        # `A5S-`)، فالاسم + الفرع بيحدّدوا حساب واحد — والرصيد بيرجع يبان بدل ما
        # الكارت يقعد على صفر وهو مديون.
        linked2 = 0
        still: list[Customer] = []
        for c in db.scalars(select(Customer).where(
                Customer.active.is_(True), Customer.customer_type == "employee",
                ~Customer.id.in_(select(CustomerAccount.customer_id)))):
            want = "AL-A5S-" if (c.code or "").startswith("AL-") else "A5S-"
            hits = [a for a in acc_by_name.get(_norm(c.name), [])
                    if (a.code or "").startswith(want) and a.id not in taken]
            if len(hits) == 1:
                taken.add(hits[0].id)
                db.add(CustomerAccount(customer_id=c.id, account_id=hits[0].id))
                linked2 += 1
            else:
                still.append(c)
        if linked2:
            db.commit()

        n_emp = db.scalar(select(func.count()).select_from(Customer)
                          .where(Customer.active.is_(True),
                                 Customer.customer_type == "employee")) or 0
        print(f"\n✔ اتعمل {made} كارت موظف. الإجمالي دلوقتي: {n_emp}")
        if linked2:
            print(f"✔ واتربط {linked2} كارت بحسابه بالفرع (الاسم لوحده كان ملتبس).")
        if still:
            print(f"\nلسه من غير حساب ({len(still)}) — مالهمش حساب مطابق في الشجرة:")
            for c in still:
                print(f"   {c.code:<18}{c.name}")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
