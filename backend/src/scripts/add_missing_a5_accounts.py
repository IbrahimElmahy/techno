from __future__ import annotations

import os
import sys
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.core.money import to_money
from src.models.ledger import (Account, AccountNature, AccountType, Direction,
                               LedgerEntry, LedgerLine)
from src.models.org import Branch
from src.scripts.import_a5 import JUNK, _clean, _money, _read
from src.scripts.import_a5_ledger import A_ACC, A_ACCNAME, A_IN, A_KEY, A_OUT

ZERO = Decimal("0")


def _frozen(db, prefix: str, groups: dict[str, list[list[str]]]) -> list[tuple]:
    tag = f"a5:{prefix}"
    mine: dict[str, LedgerEntry] = {}
    for e in db.scalars(select(LedgerEntry).where(
            LedgerEntry.external_ref.like("a5:%"))).all():
        ref = str(e.external_ref or "")
        if not ref.startswith(tag):
            continue
        rest = ref[len(tag):]
        if not prefix and not rest.isdigit():
            continue
        mine[rest] = e

    ids = [e.id for e in mine.values()]
    per_entry: dict[int, int] = defaultdict(int)
    amount: dict[int, Decimal] = defaultdict(Decimal)
    for i in range(0, len(ids), 5000):
        for ln in db.scalars(select(LedgerLine).where(
                LedgerLine.entry_id.in_(ids[i:i + 5000]))).all():
            per_entry[ln.entry_id] += 1
            amount[ln.entry_id] += Decimal(str(ln.amount or 0))

    out: list[tuple] = []
    for key, e in mine.items():
        want = [r for r in groups.get(key, [])
                if to_money(_money(r[A_IN])) != ZERO
                or to_money(_money(r[A_OUT])) != ZERO]
        if not want or per_entry[e.id] >= len(want):
            continue
        lost = sum((to_money(_money(r[A_IN])) + to_money(_money(r[A_OUT]))
                    for r in want), ZERO) - amount[e.id]
        out.append((key, e, len(want), per_entry[e.id], lost))
    return out


def run(folder: str, *, branch_name: str, prefix: str, execute: bool) -> int:
    db = SessionLocal()
    try:
        branch = db.scalar(select(Branch).where(Branch.name == branch_name))
        if branch is None:
            print(f"الفرع «{branch_name}» مش موجود.")
            return 2

        rows = [r for r in _read(os.path.join(folder, "a5_acclines.tsv"))
                if len(r) >= 12]
        if not rows:
            print(f"مافيش a5_acclines.tsv في {folder} — شغّل التصدير الأول.")
            return 2
        accs = _read(os.path.join(folder, "a5_acc.tsv"))
        subs = {r[1]: r for r in accs if r and r[0] == "SUB" and len(r) >= 4}

        nlines: dict[str, int] = defaultdict(int)
        nzero: dict[str, int] = defaultdict(int)
        money: dict[str, Decimal] = defaultdict(Decimal)
        names: dict[str, set[str]] = defaultdict(set)
        keys: dict[str, set[str]] = defaultdict(set)
        groups: dict[str, list[list[str]]] = defaultdict(list)
        for r in rows:
            groups[r[A_KEY]].append(r)
            a5id = _clean(r[A_ACC])
            amt = to_money(_money(r[A_IN])) + to_money(_money(r[A_OUT]))
            nlines[a5id] += 1
            money[a5id] += amt
            if amt != ZERO:
                nzero[a5id] += 1
            names[a5id].add(_clean(r[A_ACCNAME]))
            keys[a5id].add(r[A_KEY])

        by_code = {a.code: a for a in db.scalars(select(Account)).all() if a.code}
        missing = sorted((a for a in nlines if f"{prefix}A5S-{a}" not in by_code),
                         key=lambda x: -nzero[x])

        print(f"الفرع: {branch_name}" + (f" · البادئة: {prefix}" if prefix else ""))
        print(f"سطور الدفتر: {len(rows)} · حسابات مشار إليها: {len(nlines)}")
        print(f"منها مش موجودة في شجرتنا: {len(missing)}\n")

        makeable: list[tuple[str, str, str]] = []
        if missing:
            print(f"{'a5_id':<9}{'سطور':>7}{'بمبلغ':>7}{'المبلغ':>16}{'قيود':>7}  الحالة")
            print("-" * 96)
            for a5id in missing:
                sub = subs.get(a5id)
                snap = " / ".join(sorted(x for x in names[a5id] if x)) or "—"
                if sub is None:
                    state = f"⛔ مالوش صف في a5_acc.tsv — «{snap}» · مش هيتعمل"
                elif not _clean(sub[2]) or JUNK.match(_clean(sub[2])):
                    state = f"⛔ اسمه في a5 مش صالح «{_clean(sub[2])}» · مش هيتعمل"
                else:
                    state = f"«{_clean(sub[2])}» · أب {sub[3]}"
                    makeable.append((a5id, _clean(sub[2]), sub[3]))
                print(f"{a5id:<9}{nlines[a5id]:>7}{nzero[a5id]:>7}"
                      f"{money[a5id]:>16}{len(keys[a5id]):>7}  {state}")
            print("-" * 96)
            blocked = sum(money[a] for a in missing)
            print(f"سطور بمبلغ != 0 محجوزة: {sum(nzero[a] for a in missing)}"
                  f" · مجموعها {blocked}")
            if blocked == ZERO:
                print("كلهم بصفر — الأثر تجميلي في audit_a5_ledger_drift وبس.")

        frozen = _frozen(db, prefix, groups)
        print(f"\nقيودنا اللي سطورها أقل من a5: {len(frozen)}")
        if frozen:
            lost = sum((f[4] for f in frozen), ZERO)
            print(f"المبلغ الضايع منها: {lost}")
            print(f"   {'مفتاح a5':<12}{'قيدنا':<9}{'a5':>4}{'عندنا':>7}"
                  f"{'الضايع':>16}  النوع · التاريخ")
            for key, e, want, got, gap in sorted(frozen, key=lambda x: -abs(x[4]))[:25]:
                print(f"   {key:<12}{e.id:<9}{want:>4}{got:>7}{gap:>16}"
                      f"  {e.entry_type} · {e.entry_date}")
            if len(frozen) > 25:
                print(f"   … و{len(frozen) - 25} قيد كمان")
            print("   دول محتاجين `rebuild_a5_ledger` — إنشاء الحساب بيمنع اللي جاي بس.")

        if not makeable:
            print("\nمافيش حساب يتعمل.")
            return 0
        if not execute:
            print("\nدرايَ-رن. `--yes` عشان ينفّذ.")
            return 0

        made = 0
        for a5id, name, parent_a5 in makeable:
            parent = by_code.get(f"{prefix}A5M-{parent_a5}")
            db.add(Account(
                account_type=AccountType.user_defined, name=name,
                code=f"{prefix}A5S-{a5id}",
                nature=parent.nature if parent else AccountNature.asset,
                normal_side=parent.normal_side if parent else Direction.debit,
                parent_id=parent.id if parent else None,
                is_postable=True, is_system=False,
                branch_id=branch.id, active=True))
            made += 1
        db.commit()
        print(f"\nاتعمل {made} حساب.")
        print("شغّل `import_a5_ledger` بعده عشان القيود الجديدة تنزل كاملة،"
              " و`rebuild_a5_ledger` للقيود اللي اتجمّدت ناقصة قبل كده.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp"
    target = args[args.index("--branch") + 1] if "--branch" in args else ""
    pref = args[args.index("--prefix") + 1] if "--prefix" in args else ""
    if not target:
        print("لازم --branch (اسم الفرع اللي الحساب يتبعه).")
        sys.exit(2)
    sys.exit(run(folder, branch_name=target, prefix=pref, execute="--yes" in args))
