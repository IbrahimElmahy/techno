"""يربط كل موظف بحساب ذمته تحت مجموعة «ذمم الموظفين» في شجرة a5.

    python -m src.scripts.link_employee_receivables          # يعرض بس
    python -m src.scripts.link_employee_receivables --yes    # يربط الموجود
    python -m src.scripts.link_employee_receivables --yes --create   # ويعمل الناقص

بيتعاد تشغيله بأمان: المربوط بيتخطّى، والمربوط غلط بيتصلّح.

---------------------------------------------------------------------------
a5 ماسك ذمم الموظفين في مجموعة اسمها كده بالظبط (`A5M-22` لأكتوبر و`AL-A5M-22`
للعلياء)، وتحتها **١٤٠ حساب ورقي** — ٤٦ منهم عليهم رصيد، إجماليه ٣٦٨٬٤٥٥ ج.

**الرصيد مابيتخزّنش هنا.** بيتحسب من `ledger_line` وقت العرض. اللي بيتخزّن هو
`employee.receivable_account_id` — **مين حسابه**. السبب إن المطابقة بالاسم وقت
العرض بتوقع: «كامل هلول» و«كامل هلول شخصى» حسابين مختلفين برصيدين مختلفين
(١١٦٬٥٤٠ و١٥٣٬٠٠٠)، ومندوب الاسم لوحده مايعرفش أنهي واحد فيهم ذمة الراجل.

**المطابقة بالاسم بس عند الربط، وبحذر:**

* الاسم بيتطبّع (همزة، تاء مربوطة، مسافات) — «عبد الرحمن جمعة» في الموظفين
  و«عبد الرحمن جمعه» في الشجرة نفس الراجل.
* **المطابقة جوّه الفرع.** البادئة `AL-` هي الفرع: موظف `AL-A5E-3` بيدوّر في
  حسابات `AL-A5S-` بس. من غير القفل ده ١١ واحد طلعوا «ملبّسين» وهما مش ملبّسين —
  «مدحت البحيرى» ليه حساب في الفرعين (`A5S-49` بصفر و`AL-A5S-11` بـ١٠٬٢٠٠)، وكارت
  موظف في الفرعين كمان. كل كارت وحسابه، ومحدش بياخد فلوس التاني.

* **اللي لسه بيطابق أكتر من حساب جوّه فرعه مايتربطش** — بيتطبع في التقرير ويستنى
  عين. تخمين هنا معناه إن ذمة راجل بتتعلّق على حساب راجل تاني.
* **الحساب اللي متربط بموظف تاني مايتاخدش** — حساب واحد لواحد.
* الحساب اللي مالوش موظف (زي «عهدة سيارة الفيوم» و«فرع اكتوبر») بيتساب — ده دلو
  محاسبي مش راجل، والصفحة بتوريه لوحده تحت «حسابات بلا موظف» عشان مايختفيش.

---------------------------------------------------------------------------
**`--create`: الموظف اللي مالوش حساب أصلاً.**

فيه موظفين مالهمش أي حساب في شجرة a5 — اتسجّلوا عندنا بعد النقل، أو a5 نفسه ما
فتحش لهم حساب لأنهم ما أخدوش سلفة قط. الربط لوحده مابيخدمهمش: مافيش حاجة يتربطوا
بيها، وأول سلفة أو مرتب عليهم مالوش مكان يتكتب فيه.

`--create` بيفتح لكل واحد **حساب ورقي جديد تحت مجموعة ذمم فرعه**، باسمه وبكود
متسلسل من نفس نمط المجموعة، وبيربطه بيه. والحساب بيتولد **فاضي** — مافيش رصيد
افتتاحي ولا قيد: ده حساب لسه ما اتحركش، مش حساب فيه فلوس.

**والموقوف مابيتعملّوش حساب.** الموظف اللي خرج من الشركة مالوش ذمة جاية، والحساب
الفاضي على اسمه بيزوّد الشجرة من غير سبب.
"""
from __future__ import annotations

import re
import sys

from sqlalchemy import case, func, select

from src.core.db import SessionLocal
from src.models.employee import Employee
from src.models.ledger import Account, AccountNature, Direction, LedgerLine

GROUPS = ("A5M-22", "AL-A5M-22")   # «ذمم الموظفين» — أكتوبر والعلياء


def norm(s: str | None) -> str:
    """تطبيع للمطابقة: همزة، تاء مربوطة، ألف مقصورة، مسافات."""
    s = re.sub(r"[أإآٱ]", "ا", s or "").replace("\xa0", " ")
    s = s.replace("ة", "ه").replace("ى", "ي")
    return re.sub(r"\s+", " ", s).strip()


def _next_code(db, group: Account, existing: list[Account]) -> str:
    """كود جديد على نمط إخوته: `AL-A5S-2196` بعد `AL-A5S-2195`."""
    pat = re.compile(r"^(.*?)(\d+)$")
    best_prefix, best_num = None, 0
    for a in existing:
        m = pat.match(a.code or "")
        if m and int(m.group(2)) > best_num:
            best_prefix, best_num = m.group(1), int(m.group(2))
    if best_prefix is None:
        best_prefix, best_num = f"{group.code}-", 0
    code = f"{best_prefix}{best_num + 1}"
    while db.scalar(select(Account).where(Account.code == code)):
        best_num += 1
        code = f"{best_prefix}{best_num + 1}"
    return code


def run(*, execute: bool, create: bool = False) -> None:
    db = SessionLocal()
    try:
        bal = dict(db.execute(
            select(LedgerLine.account_id,
                   func.sum(case((LedgerLine.direction == Direction.debit,
                                  LedgerLine.amount), else_=0))
                   - func.sum(case((LedgerLine.direction == Direction.credit,
                                    LedgerLine.amount), else_=0)))
            .group_by(LedgerLine.account_id)).all())

        leaves: list[Account] = []
        for gcode in GROUPS:
            g = db.scalar(select(Account).where(Account.code == gcode))
            if g is None:
                print(f"⚠ مجموعة «{gcode}» مش موجودة — اتخطّت")
                continue
            leaves += db.scalars(
                select(Account).where(Account.parent_id == g.id)).all()

        def pfx(code: str | None) -> str:
            """الفرع من الكود: `AL-` للعلياء وفاضي لأكتوبر."""
            return "AL-" if (code or "").startswith("AL-") else ""

        # (الفرع، الاسم المتطبّع) → الحسابات. الفرع جزء من المفتاح عشان الراجل
        # اللي ليه حساب في الفرعين مايبقاش «ملبّس».
        by_name: dict[tuple[str, str], list[Account]] = {}
        for a in leaves:
            by_name.setdefault((pfx(a.code), norm(a.name)), []).append(a)

        emps = db.scalars(select(Employee)).all()
        used = {e.receivable_account_id for e in emps if e.receivable_account_id}

        plan: list[tuple[Employee, Account]] = []
        ambiguous: list[str] = []
        taken: list[str] = []
        already = nomatch = 0

        for e in emps:
            hits = by_name.get((pfx(e.code), norm(e.name)), [])
            if not hits:
                nomatch += 1
                continue
            if len(hits) > 1:
                ambiguous.append(
                    f"«{e.name}» ({e.code}) بيطابق "
                    + " · ".join(f"{a.code}={bal.get(a.id, 0)}" for a in hits))
                continue
            a = hits[0]
            if e.receivable_account_id == a.id:
                already += 1
                continue
            if a.id in used and e.receivable_account_id != a.id:
                other = next((x for x in emps if x.receivable_account_id == a.id), None)
                taken.append(f"{a.code} «{a.name}» محجوز لـ{other.code if other else '?'}")
                continue
            plan.append((e, a))
            used.add(a.id)

        keys = {(pfx(e.code), norm(e.name)) for e in emps}
        orphans = [a for a in leaves if (pfx(a.code), norm(a.name)) not in keys]

        print(f"حسابات تحت «ذمم الموظفين»: {len(leaves)}   ·   موظفين: {len(emps)}")
        print(f"   {'هيتربط':<30}{len(plan):>6}")
        print(f"   {'متربط خلاص':<30}{already:>6}")
        print(f"   {'موظف مالوش حساب':<30}{nomatch:>6}")
        print(f"   {'حساب مالوش موظف':<30}{len(orphans):>6}")
        print(f"   {'اسم بيطابق أكتر من حساب':<30}{len(ambiguous):>6}")

        withbal = [(e, a) for e, a in plan if bal.get(a.id, 0)]
        if withbal:
            print("\n   اللي عليهم رصيد:")
            for e, a in sorted(withbal, key=lambda x: -abs(bal.get(x[1].id, 0)))[:15]:
                print(f"      {e.code:<12}{(e.name or '')[:24]:<26}{a.code:<14}"
                      f"{bal.get(a.id, 0):>14}")
        # --- الموظف اللي مالوش حساب: يتعمل له واحد --------------------------------
        missing = [e for e in emps
                   if not e.receivable_account_id
                   and not by_name.get((pfx(e.code), norm(e.name)))
                   and e.active]
        if missing:
            print(f"\n   موظفين نشطين مالهمش حساب ({len(missing)}):")
            for e in missing:
                print(f"      {e.code or '-':<14}{(e.name or '')[:30]}")
            if not create:
                print("      ضيف --create عشان يتعملهم حسابات جديدة.")

        if ambiguous:
            print(f"\n⚠ محتاج عين — مااتربطش ({len(ambiguous)}):")
            for x in ambiguous:
                print("   •", x)
        if taken:
            print(f"\n⚠ حساب محجوز ({len(taken)}):")
            for x in taken:
                print("   •", x)
        orph_bal = [a for a in orphans if bal.get(a.id, 0)]
        if orph_bal:
            print(f"\n   حسابات برصيد ومالهاش موظف ({len(orph_bal)}):")
            for a in sorted(orph_bal, key=lambda x: -abs(bal.get(x.id, 0)))[:10]:
                print(f"      {a.code:<14}{(a.name or '')[:28]:<30}{bal.get(a.id, 0):>14}")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for e, a in plan:
            e.receivable_account_id = a.id
        db.commit()

        made = 0
        if create and missing:
            # المجموعة بتتحدد من فرع الموظف زي ما الكود بيقوله — نفس القاعدة اللي
            # المطابقة ماشية عليها، عشان الحساب الجديد يقع في نفس المكان.
            groups = {}
            for gcode in GROUPS:
                g = db.scalar(select(Account).where(Account.code == gcode))
                if g is not None:
                    groups["AL-" if gcode.startswith("AL-") else ""] = g
            for e in missing:
                group = groups.get(pfx(e.code))
                if group is None:
                    print(f"   ⚠ «{e.name}» مالوش مجموعة ذمم في فرعه — اتخطّى")
                    continue
                siblings = list(db.scalars(
                    select(Account).where(Account.parent_id == group.id)).all())
                acc = Account(
                    code=_next_code(db, group, siblings),
                    name=e.name,
                    parent_id=group.id,
                    nature=group.nature or AccountNature.asset,
                    normal_side=group.normal_side,
                    is_postable=True,
                    is_system=False,
                    active=True,
                )
                db.add(acc)
                db.flush()
                e.receivable_account_id = acc.id
                made += 1
                print(f"   + {acc.code:<16}{(e.name or '')[:30]}")
            db.commit()
            print(f"\n✔ اتعمل {made} حساب جديد واتربطوا")

        n = db.scalar(select(func.count()).select_from(Employee)
                      .where(Employee.receivable_account_id.is_not(None))) or 0
        print(f"\n✔ اتربط {len(plan)} موظف")
        print(f"   موظفين ليهم حساب ذمة دلوقتي: {n}")
    finally:
        db.close()


def main() -> None:
    args = sys.argv[1:]
    run(execute="--yes" in args, create="--create" in args)


if __name__ == "__main__":
    main()
