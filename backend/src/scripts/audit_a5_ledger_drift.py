from __future__ import annotations

import os
import sys
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.ledger import Account, Direction, LedgerEntry, LedgerLine
from src.scripts.import_a5 import _clean, _money, _read
from src.scripts.import_a5_ledger import (A_ACC, A_DATE, A_IN, A_KEY, A_OUT,
                                          _date)

ZERO = Decimal("0")
TOL = Decimal("0.005")


def theirs(folder: str) -> dict[str, dict]:
    groups: dict[str, list[list[str]]] = defaultdict(list)
    for r in _read(os.path.join(folder, "a5_acclines.tsv")):
        if len(r) >= 12:
            groups[r[A_KEY]].append(r)
    out: dict[str, dict] = {}
    for key, g in groups.items():
        debit = sum((Decimal(str(_money(r[A_IN]))) for r in g), ZERO)
        credit = sum((Decimal(str(_money(r[A_OUT]))) for r in g), ZERO)
        live = [r for r in g if _money(r[A_IN]) or _money(r[A_OUT])]
        out[key] = {
            "amount": debit,
            "credit": credit,
            "date": _date(g[0][A_DATE]),
            "accounts": sorted({_clean(r[A_ACC]) for r in live}),
            "rows": len(live),
        }
    return out


def run(folder: str, prefix: str) -> int:
    db = SessionLocal()
    try:
        src = theirs(folder)
        if not src:
            print(f"مافيش a5_acclines.tsv في {folder} — شغّل التصدير الأول.")
            return 2
        print(f"قيود a5 في التصدير: {len(src)}")

        acc_code = {a.id: (a.code or "") for a in db.scalars(select(Account)).all()}

        mine: dict[str, LedgerEntry] = {}
        for e in db.scalars(select(LedgerEntry).where(
                LedgerEntry.external_ref.is_not(None))).all():
            ref = str(e.external_ref or "")
            tag = f"a5:{prefix}" if prefix else "a5:"
            if not ref.startswith(tag):
                continue
            mine[ref[len(tag):]] = e
        print(f"قيودنا المنقولة من الفرع ده: {len(mine)}")

        amount_off: list[tuple] = []
        rows_off: list[tuple] = []
        date_off: list[tuple] = []
        acc_off: list[tuple] = []
        missing = 0

        for key, want in src.items():
            e = mine.get(key)
            if e is None:
                missing += 1
                continue
            lines = db.scalars(select(LedgerLine).where(
                LedgerLine.entry_id == e.id)).all()
            got = sum((Decimal(str(l.amount or 0)) for l in lines
                       if l.direction == Direction.debit), ZERO)
            got_cr = sum((Decimal(str(l.amount or 0)) for l in lines
                          if l.direction == Direction.credit), ZERO)
            if abs(got - want["amount"]) > TOL or abs(got_cr - want["credit"]) > TOL:
                amount_off.append((key, e, max(want["amount"], want["credit"]),
                                   max(got, got_cr)))
            if len(lines) != want["rows"]:
                rows_off.append((key, e, want["rows"], len(lines)))
            if want["date"] and e.entry_date and want["date"] != e.entry_date:
                date_off.append((key, e, want["date"], e.entry_date))
            ours_acc = sorted({acc_code.get(l.account_id, "") for l in lines})
            theirs_acc = sorted({f"{prefix}A5S-{c}" for c in want["accounts"]})
            if ours_acc and theirs_acc and ours_acc != theirs_acc:
                acc_off.append((key, e, theirs_acc, ours_acc))

        print("")
        print(f"قيود في a5 ومش عندنا:        {missing}")
        print(f"قيود مبلغها اتغيّر:          {len(amount_off)}")
        print(f"قيود عدد سطورها مختلف:      {len(rows_off)}")
        print(f"قيود تاريخها اتغيّر:         {len(date_off)}")
        print(f"قيود حساباتها اتغيّرت:       {len(acc_off)}")

        if amount_off:
            gap = sum((w - g for _k, _e, w, g in amount_off), ZERO)
            print(f"\nفرق المبالغ (a5 − عندنا): {gap}")
            print(f"\n{'مفتاح a5':<12}{'قيدنا':<9}{'a5':>16}{'عندنا':>16}{'الفرق':>14}")
            print("-" * 68)
            for key, e, want, got in sorted(
                    amount_off, key=lambda x: -abs(x[2] - x[3]))[:40]:
                print(f"{key:<12}{e.id:<9}{want:>16}{got:>16}{want - got:>14}")
            if len(amount_off) > 40:
                print(f"… و{len(amount_off) - 40} قيد كمان")

        for label, rows in (("تاريخ", date_off), ("سطور", rows_off),
                            ("حسابات", acc_off)):
            if not rows:
                continue
            print(f"\n{label}:")
            for key, e, want, got in rows[:15]:
                print(f"   {key:<12}قيد {e.id:<8} a5={want}   عندنا={got}")
            if len(rows) > 15:
                print(f"   … و{len(rows) - 15} كمان")

        return 1 if (amount_off or rows_off or date_off or acc_off) else 0
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp"
    prefix = args[args.index("--prefix") + 1] if "--prefix" in args else ""
    sys.exit(run(folder, prefix))
