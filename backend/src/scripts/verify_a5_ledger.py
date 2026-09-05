"""يقارن رصيد كل حساب في الدفتر عندنا برصيده عند a5 — بالكود، تفاوت قرش. قراءة بس.

    python -m src.scripts.verify_a5_ledger --dir C:/pgtmp
    python -m src.scripts.verify_a5_ledger --dir C:/pgtmp/aliaa --prefix AL-

بيخرج بكود ١ لو فيه حساب مختلف أو حساب عند a5 عليه حركة ومش عندنا.

---------------------------------------------------------------------------
**المسطرة:** عند a5 رصيد الحساب = Σ`AccIn` − Σ`AccOut` على `acc` لكل `AccBrnch_id`.
عندنا = Σمدين − Σدائن على `ledger_line` للحساب اللي كوده `{prefix}A5S-{AccBrnch_id}`.
نفس الإشارة على الجانبين، فالمقارنة مباشرة من غير ما نعتمد على طبيعة الحساب.

**بالكود مش بالاسم.** `import_a5_ledger` ربط كل سطر بحسابه بالكود ده بالظبط، فالتحقق
لازم يمشي على نفس المفتاح — وإلا بنقارن على اسم اتغيّر عندنا أو اتكرر عندهم.

**الحساب اللي عند a5 عليه حركة ومش عندنا** = سطور دفتر ضاعت. ده الفرق اللي
`diag_ledger_gap` بيشرحه صف صف؛ هنا بنقيسه بالمبلغ.
"""
from __future__ import annotations

import os
import sys
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.ledger import Account, Direction, LedgerLine
from src.scripts.import_a5 import _clean, _money, _read

# أعمدة a5_acclines.tsv — زي import_a5_ledger بالظبط
A_KEY, A_DATE, A_ACC, A_ACCNAME, A_IN, A_OUT = 0, 1, 2, 3, 4, 5
TOL = Decimal("0.01")


def run(folder: str, prefix: str) -> None:
    path = os.path.join(folder, "a5_acclines.tsv")
    if not os.path.exists(path):
        raise SystemExit(f"مافيش {path} — شغّل a5_sync.ps1 -ExportOnly الأول.")

    theirs: dict[str, Decimal] = defaultdict(Decimal)
    names: dict[str, str] = {}
    for r in _read(path):
        if len(r) < 6 or not _clean(r[A_ACC]).isdigit():
            continue
        acc_id = _clean(r[A_ACC])
        theirs[acc_id] += _money(r[A_IN]) - _money(r[A_OUT])
        names.setdefault(acc_id, _clean(r[A_ACCNAME]))

    db = SessionLocal()
    try:
        accounts = {
            a.code[len(prefix) + 4:]: a          # «A5S-» أربعة حروف
            for a in db.scalars(select(Account).where(Account.code.like(f"{prefix}A5S-%")))
            if a.code and (prefix or not a.code.startswith("AL-"))
        }
        ours: dict[int, Decimal] = defaultdict(Decimal)
        if accounts:
            ids = [a.id for a in accounts.values()]
            for acc_id, direction, amt in db.execute(
                    select(LedgerLine.account_id, LedgerLine.direction,
                           func.sum(LedgerLine.amount))
                    .where(LedgerLine.account_id.in_(ids))
                    .group_by(LedgerLine.account_id, LedgerLine.direction)).all():
                ours[acc_id] += Decimal(amt) * (1 if direction == Direction.debit else -1)

        matched = different = 0
        missing: list[tuple[Decimal, str, str]] = []
        worst: list[tuple[Decimal, str, str, Decimal, Decimal]] = []
        for a5_id, bal in theirs.items():
            acc = accounts.get(a5_id)
            if acc is None:
                if abs(bal) >= TOL:
                    missing.append((abs(bal), a5_id, names.get(a5_id, "")))
                continue
            mine_bal = ours.get(acc.id, Decimal(0))
            if abs(mine_bal - bal) < TOL:
                matched += 1
            else:
                different += 1
                worst.append((abs(mine_bal - bal), a5_id, acc.name, bal, mine_bal))

        label = prefix or "(أكتوبر)"
        print(f"حسابات a5 عليها حركة {label}: {len(theirs)}")
        print(f"   مطابق (±0.01)        {matched}")
        print(f"   مختلف                {different}")
        print(f"   عند a5 ومش عندنا     {len(missing)}")
        print(f"\nΣ a5: {sum(theirs.values()):,.2f}   Σ عندنا: {sum(ours.values()):,.2f}")
        if worst:
            worst.sort(reverse=True)
            print("\nأكبر الفروق:")
            for _d, a5_id, name, a, b in worst[:20]:
                print(f"   A5S-{a5_id:<7} {name[:30]:<32} a5={a:>14,.2f}  عندنا={b:>14,.2f}")
        if missing:
            missing.sort(reverse=True)
            print("\nحسابات عند a5 عليها رصيد ومش في شجرتنا:")
            for bal, a5_id, name in missing[:20]:
                print(f"   A5S-{a5_id:<7} {name[:30]:<32} {bal:>14,.2f}")
        if different or missing:
            sys.exit(1)
        print("\n✔ مطابق.")
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp"
    prefix = args[args.index("--prefix") + 1] if "--prefix" in args else ""
    run(folder, prefix)
