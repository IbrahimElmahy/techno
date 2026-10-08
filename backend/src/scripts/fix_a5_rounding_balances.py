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
    a5: dict[tuple[str, str, str], list[Decimal]] = defaultdict(list)
    for ln in open(rows_file, encoding="utf-8"):
        p = ln.rstrip("\n").split("~")
        if len(p) < 6 or p[0] != "R":
            continue
        sysfree, acc = p[2].strip(), p[3].strip()
        a_in, a_out = Decimal(p[4] or "0"), Decimal(p[5] or "0")
        d2, c2 = _r2(a_in), _r2(a_out)
        if d2 == ZERO and c2 == ZERO:
            continue
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

        ours: dict[tuple[str, str, str], list] = defaultdict(list)
        exact: dict[int, Decimal] = {}
        ref_p = f"a5:{prefix}"
        for lid, code, dirn, amt, ref, _d, _e in lines:
            if ref and ref.startswith(ref_p):
                ours[(ref[len(ref_p):], code, dirn)].append((Decimal(str(amt)), lid))
            else:
                exact[lid] = Decimal(str(amt))
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

        by_acc: dict[str, list] = defaultdict(list)
        for lid, code, dirn, amt, _ref, d, eid in lines:
            by_acc[code].append((d, eid, lid, dirn, Decimal(str(amt))))
        plan: list[tuple[int, str, Decimal]] = []
        worst = ZERO
        for code, rows in by_acc.items():
            rows.sort(key=lambda r: (str(r[0] or ''), r[1], r[2]))
            cum4 = ZERO
            prev2 = ZERO
            out: list[list] = []
            for _d, _e, lid, dirn, amt in rows:
                sign = 1 if dirn == "debit" else -1
                cum4 += exact[lid] * sign
                frac = exact[lid] != _r2(exact[lid])
                if not frac:
                    signed = exact[lid] * sign
                    prev2 += signed
                else:
                    now2 = _r2(cum4)
                    signed = now2 - prev2
                    prev2 = now2
                out.append([lid, dirn, amt, signed, frac])
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
