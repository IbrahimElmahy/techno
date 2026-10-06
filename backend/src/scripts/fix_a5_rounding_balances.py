"""كشف حساب كل حساب في فرع = كشف a5 بالقرش، سطر بسطر (٢٠٢٦-١٠-٠٦).

    python -m src.scripts.fix_a5_rounding_balances --rows /opt/techno/a5factory/a5_acc_rows4.txt --branch السادات --prefix FC-
    python -m src.scripts.fix_a5_rounding_balances ... --yes

**منين القروش.** a5 بيمسك أربع خانات عشرية وإحنا اتنين. وقت النقل كل سطر اتقرّب لوحده،
و`import_a5_ledger._absorb_rounding` وزن كل قيد ببلع فرق التقريب في أكبر سطر فيه. القيد
بيتوزن، بس السطر الكبير بيطلع بقروش زيادة (٤٦١٬٦٩٢٫٣٠٦٢ عند a5 ⇐ ٤٦١٬٦٩٢٫٣٤ عندنا)،
والقروش بتتراكم على الحساب.

النسخة الأولى من السكربت ده (٢٠٢٦-١٠-٠٥) كانت بتحط فرق الحساب كله على آخر سطر. الرصيد
النهائي طلع مظبوط، بس السطر نفسه بقى غلط: تحصيل ١٠٠٬٠٠٠ عند a5 طلع ١٠٠٬٠٠٠٫٨٢ في كشف
«فرع اكتوبر»، ورصيد أول المدة اتغيّر (نرمين، ٢٠٢٦-١٠-٠٦).

**الإصلاح: تقريب تراكمي على كل حساب.** المبلغ الدقيق لكل سطر بيتاخد من a5 بالأربع خانات،
والسطور بتترتّب زي الكشف (التاريخ ثم القيد ثم السطر). السطر بيتكتب = (الرصيد الدقيق بعده
مقرّب لقرش) − (الرصيد الدقيق قبله مقرّب لقرش). النتيجة:

* الرصيد بعد كل سطر = رصيد a5 مقرّب لقرش — فرصيد أول المدة والختامي لأي فترة زي a5.
* كل مبلغ = مبلغ a5 مقرّب، أو بفرق قرش واحد بالكتير.

القيد بيبقى بين مدينه ودائنه فرق قروش — زي ما هو عند a5 نفسه لما يتقرّب لخانتين. القيود
دي a5 (مرجعها `a5:`)، ومافيش في السادات تسويات سداد عليها.

**`--rows`:** ملف `SELECT` بس على `acc` (محدود بآخر `acc_id` في التصدير):

    SELECT 'R', acc_id, sysfree, AccBrnch_id, AccIn, AccOut FROM acc WHERE acc_id <= <آخر acc_id>

السطر عندنا بيتقابل مع صف a5 جوّه نفس القيد (`sysfree`) ونفس الحساب ونفس الناحية،
بالترتيب بالمبلغ — التقريب بيغيّر قروش، مابيغيّرش الترتيب.

مقفول على الفرع والبادئة. بيتعاد بأمان، وشغّله بعد أي `rebuild_a5_ledger` / `import_a5_ledger`.
"""
from __future__ import annotations

import sys
from collections import defaultdict
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import text

from src.core.db import SessionLocal

C = Decimal("0.01")
ZERO = Decimal("0")


def _r2(x: Decimal) -> Decimal:
    return x.quantize(C, ROUND_HALF_UP)


def run(rows_file: str, *, branch_name: str, prefix: str, execute: bool) -> int:
    # صفوف a5: (sysfree, حساب, ناحية) ← [المبلغ الدقيق]
    a5: dict[tuple[str, str, str], list[Decimal]] = defaultdict(list)
    for ln in open(rows_file, encoding="utf-8"):
        p = ln.rstrip("\n").split("~")
        if len(p) < 6 or p[0] != "R":
            continue
        sysfree, acc = p[2].strip(), p[3].strip()
        a_in, a_out = Decimal(p[4] or "0"), Decimal(p[5] or "0")
        d2, c2 = _r2(a_in), _r2(a_out)
        if d2 == ZERO and c2 == ZERO:
            continue                      # نفس تخطّي `import_a5_ledger`
        out = c2 > d2
        a5[(sysfree, f"{prefix}A5S-{acc}", "credit" if out else "debit")].append(
            a_out if out else a_in)

    db = SessionLocal()
    try:
        bid = db.execute(text("select id from branch where name=:n"), {"n": branch_name}).scalar_one()
        lines = db.execute(text("""
            select l.id, a.code, l.direction::text, l.amount, e.external_ref, e.entry_date, e.id
            from ledger_line l join ledger_entry e on e.id = l.entry_id
            join account a on a.id = l.account_id
            where a.branch_id = :b and a.code like :p"""),
            {"b": bid, "p": f"{prefix}A5S-%"}).all()

        # المبلغ الدقيق لكل سطر عندنا.
        ours: dict[tuple[str, str, str], list] = defaultdict(list)
        exact: dict[int, Decimal] = {}
        ref_p = f"a5:{prefix}"
        for lid, code, dirn, amt, ref, _d, _e in lines:
            if ref and ref.startswith(ref_p):
                ours[(ref[len(ref_p):], code, dirn)].append((Decimal(str(amt)), lid))
            else:
                exact[lid] = Decimal(str(amt))     # سطر مش من a5 — زي ما هو
        mismatch = 0
        for key, mine in ours.items():
            theirs = a5.get(key, [])
            if len(theirs) != len(mine):
                mismatch += 1
                if mismatch <= 12:
                    print(f"   ماتقابلش: قيد {key[0]} حساب {key[1]} {key[2]} — "
                          f"a5 {len(theirs)} سطر، عندنا {len(mine)}: "
                          f"{[str(t) for t in theirs][:3]} / {[str(a) for a, _ in mine][:3]}")
                for amt, lid in mine:
                    exact[lid] = amt
                continue
            for (amt, lid), t in zip(sorted(mine), sorted(theirs)):
                exact[lid] = t

        # التقريب التراكمي بترتيب الكشف.
        by_acc: dict[str, list] = defaultdict(list)
        for lid, code, dirn, amt, _ref, d, eid in lines:
            by_acc[code].append((d, eid, lid, dirn, Decimal(str(amt))))
        plan: list[tuple[int, str, Decimal]] = []
        worst = ZERO
        for code, rows in by_acc.items():
            rows.sort(key=lambda r: (str(r[0] or ''), r[1], r[2]))
            cum4 = ZERO
            prev2 = ZERO
            out: list[list] = []          # [السطر، الناحية الأصلية، المبلغ القديم، الموقّع الجديد، فيه كسور؟]
            for _d, _e, lid, dirn, amt in rows:
                sign = 1 if dirn == "debit" else -1
                cum4 += exact[lid] * sign
                frac = exact[lid] != _r2(exact[lid])
                if not frac:
                    # **المبلغ اللي اتكتب بالقرش بيفضل زي ما اتكتب.** تحصيل ١٠٬٠٠٠ عند a5
                    # كان بيطلع ١٠٬٠٠٠٫٠٣ لأن القرش بيقع على أول سطر بيعدّي الحد (نرمين
                    # ٢٠٢٦-١٠-٠٦). المبلغ الصحيح مابيغيّرش تقريب الرصيد، فالرصيد بعده
                    # بيفضل = رصيد a5 مقرّب — والقروش بتقع على السطور اللي فيها كسور أصلاً.
                    signed = exact[lid] * sign
                    prev2 += signed
                else:
                    now2 = _r2(cum4)
                    signed = now2 - prev2
                    prev2 = now2
                out.append([lid, dirn, amt, signed, frac])
            # نص القرش وهو بيعدّي من موجب لسالب (التقريب بعيد عن الصفر) ممكن يسيب قرش في
            # الآخر — بيتحط على آخر سطر فيه كسور، مش على مبلغ مكتوب بالقرش.
            gap = _r2(cum4) - prev2
            if gap:
                for o in reversed(out):
                    if o[4]:
                        o[3] += gap
                        break
            for lid, dirn, amt, signed, _f in out:
                new_dir = dirn if signed == 0 else ("debit" if signed > 0 else "credit")
                new_amt = abs(signed)
                worst = max(worst, abs(new_amt - _r2(exact[lid])) if new_dir == dirn else new_amt)
                if new_amt != amt or new_dir != dirn:
                    plan.append((lid, new_dir, new_amt))

        print(f"فرع {branch_name}: سطور {len(lines)} · هتتظبط {len(plan)} · "
              f"أكبر فرق سطر عن a5 بعد الإصلاح {worst} · قيود ماتقابلتش {mismatch}")
        if not execute:
            print("عرض فقط — `--yes` للتنفيذ.")
            return 0
        for lid, dirn, amt in plan:
            db.execute(text("update ledger_line set direction = cast(:d as direction), amount = :a "
                            "where id = :i"), {"d": dirn, "a": amt, "i": lid})
        db.commit()
        print(f"✔ اتظبط {len(plan)} سطر — في {branch_name} بس.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    a = sys.argv[1:]
    rows = a[a.index("--rows") + 1] if "--rows" in a else ""
    prefix = a[a.index("--prefix") + 1] if "--prefix" in a else ""
    branch = a[a.index("--branch") + 1] if "--branch" in a else ""
    if not rows or not branch or not prefix:
        print("لازم --rows و--branch و--prefix.")
        sys.exit(2)
    sys.exit(run(rows, branch_name=branch, prefix=prefix, execute="--yes" in a))
