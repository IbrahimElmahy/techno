"""رصيد كل حساب في فرع = رصيد a5 بالقرش — بيشيل كسور التقريب المتجمّعة (٢٠٢٦-١٠-٠٥).

    python -m src.scripts.fix_a5_rounding_balances --dir /opt/techno/a5factory --branch السادات --prefix FC-
    python -m src.scripts.fix_a5_rounding_balances ... --yes

**منين الكسور.** a5 بيمسك أربع خانات عشرية وإحنا اتنين. `import_a5_ledger._absorb_rounding`
بيوزن كل قيد ببلع فرق التقريب في أكبر سطر فيه — القيد بيتوزن، بس القروش دي بتتراكم على
الحساب اللي سطره كان الأكبر. في السادات: ٣٣ حساب فرقهم من قرش لـ٨٣ قرش عن a5، ومجموع
مديونيات العملاء بيفرق ٢٫٤٧.

**الإصلاح:** الهدف لكل حساب = رصيد a5 بالدقة الكاملة (`a5_acclines.tsv`) مقرّب لقرش. الفرق
بيتحط على **آخر سطر a5** على الحساب ده (مش مربوط بتسوية سداد) — الأرصدة اللي قبله في الكشف
مابتتغيّرش، والرصيد النهائي بيبقى زي a5 بالظبط. مافيش قيد جديد ولا حساب «فروق تقريب».

القيد اللي سطره اتعدّل بيبقى مختلف بين مدينه ودائنه بالقروش دي — زي ما هو عند a5 نفسه لما
يتقرّب لخانتين. القيود دي a5 أصلاً (مرجعها `a5:`) ومابتتعملش عندنا.

**`--exact`:** تصدير القيود (`exp_acc.sql`) بيقرّب كل سطر لقرشين، فمجموعه مش رصيد a5 الحقيقي
(«فرع العلياء» في السادات: مجموع المقرّب −٢١٥٬٢٤٣٫٩٦ والحقيقي −٢١٥٬٢٤٤٫١٢). الملف ده
(`SELECT` بس على `acc`، محدود بآخر `acc_id` في التصدير) فيه لكل حساب: الرصيد بالدقة الكاملة
ومجموعه مقرّب سطر سطر — والفرق بينهم بيتزوّد على مجموع التصدير:

    SELECT 'X', AccBrnch_id, SUM(AccIn-AccOut), SUM(ROUND(AccIn,2)-ROUND(AccOut,2)), COUNT(*)
    FROM acc WHERE acc_id <= <آخر acc_id في a5_acclines> GROUP BY AccBrnch_id

مقفول على الفرع والبادئة. بيتعاد بأمان: الحساب اللي مطابق مابيتلمسش. شغّله بعد أي
`rebuild_a5_ledger` / `import_a5_ledger` لأنهم بيرجّعوا القيود بالتقريب القديم.
"""
from __future__ import annotations

import os
import sys
from collections import defaultdict
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import text

from src.core.db import SessionLocal
from src.scripts.import_a5 import _clean, _money, _read
from src.scripts.import_a5_ledger import A_ACC, A_IN, A_OUT

C = Decimal("0.01")


def run(folder: str, *, branch_name: str, prefix: str, execute: bool,
        exact_file: str = "") -> int:
    exact: dict[str, Decimal] = defaultdict(Decimal)
    for r in _read(os.path.join(folder, "a5_acclines.tsv")):
        if len(r) >= 12:
            exact[f"{prefix}A5S-{_clean(r[A_ACC])}"] += (Decimal(str(_money(r[A_IN])))
                                                       - Decimal(str(_money(r[A_OUT]))))
    if exact_file:
        for ln in open(exact_file, encoding="utf-8"):
            p = ln.strip().split("~")
            if len(p) >= 4 and p[0] == "X":
                exact[f"{prefix}A5S-{p[1].strip()}"] += Decimal(p[2]) - Decimal(p[3])
    db = SessionLocal()
    try:
        bid = db.execute(text("select id from branch where name=:n"), {"n": branch_name}).scalar_one()
        ours = {code: (aid, Decimal(str(b))) for aid, code, b in db.execute(text("""
            select a.id, a.code, coalesce(sum(case when l.direction='debit' then l.amount
                                                    else -l.amount end), 0)
            from account a left join ledger_line l on l.account_id = a.id
            where a.branch_id = :b and a.code like :p group by 1, 2"""),
            {"b": bid, "p": f"{prefix}A5S-%"}).all()}

        plan = []
        for code, (aid, bal) in ours.items():
            if code not in exact:
                continue
            target = exact[code].quantize(C, ROUND_HALF_UP)
            diff = target - bal
            if diff == 0:
                continue
            # آخر سطر a5 على الحساب، مش داخل في تسوية سداد، ومبلغه يستحمل التعديل.
            ln = db.execute(text("""
                select l.id, l.direction::text, l.amount, e.external_ref, e.entry_date
                from ledger_line l join ledger_entry e on e.id = l.entry_id
                where l.account_id = :a and e.external_ref like :r and e.branch_id = :b
                  and l.full_reconcile_id is null
                  and not exists (select 1 from partial_reconcile p
                                  where p.debit_line_id = l.id or p.credit_line_id = l.id)
                  and l.amount > :m
                order by e.entry_date desc nulls last, e.id desc, l.id desc limit 1"""),
                {"a": aid, "r": f"a5:{prefix}%", "b": bid, "m": abs(diff) + C}).first()
            plan.append((code, bal, target, diff, ln))

        print(f"فرع {branch_name}: حسابات فيها كسور تقريب {len(plan)}")
        for code, bal, target, diff, ln in sorted(plan, key=lambda x: -abs(x[3])):
            where = f"سطر {ln[0]} ({ln[3]}، {ln[4]})" if ln else "⚠ مالقيتش سطر مناسب"
            print(f"   {code:<14} عندنا {bal:>16,.2f}  a5 {target:>16,.2f}  فرق {diff:>6}  ← {where}")
        if not execute:
            print("\nعرض فقط — `--yes` للتنفيذ.")
            return 0
        n = 0
        for _code, _bal, _t, diff, ln in plan:
            if ln is None:
                continue
            # المدين بيزوّد الرصيد والدائن بيقلّله.
            delta = diff if ln[1] == "debit" else -diff
            db.execute(text("update ledger_line set amount = amount + :d, "
                            "amount_residual = case when amount_residual is null then null "
                            "else amount_residual + :d end where id = :i"),
                       {"d": delta, "i": ln[0]})
            n += 1
        db.commit()
        print(f"\n✔ اتظبط {n} حساب على رصيد a5 بالقرش — في {branch_name} بس.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    a = sys.argv[1:]
    folder = a[a.index("--dir") + 1] if "--dir" in a else "C:/pgtmp"
    prefix = a[a.index("--prefix") + 1] if "--prefix" in a else ""
    branch = a[a.index("--branch") + 1] if "--branch" in a else ""
    if not branch or not prefix:
        print("لازم --branch و--prefix.")
        sys.exit(2)
    exact_file = a[a.index("--exact") + 1] if "--exact" in a else ""
    sys.exit(run(folder, branch_name=branch, prefix=prefix, execute="--yes" in a,
                 exact_file=exact_file))
