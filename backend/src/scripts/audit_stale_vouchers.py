"""تدقيق قيود a5: سطورنا مقابل سطور المصدر الحالية لكل sysfree.

    python -m src.scripts.audit_stale_vouchers --aliaa-dir C:/pgtmp/aliaa --oct-dir C:/pgtmp

قراءة فقط — مابيكتبش حاجة. بيصنّف كل قيد عندنا ليه مرجع a5:

* `stale` — الـsysfree اختفى من a5 (تعديل رجعي مسح القيد): المرشح للمسح.
* `legs-differ` — نفس الـsysfree لكن السطور مختلفة (تقسيم/تعديل مبلغ): محتاج مراجعة.
* `match` — مطابق.
* `no-source` — المرجع مالوش أثر في ملفات التصدير الحالية.
"""
from __future__ import annotations

import os
import sys
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.ledger import Account, LedgerEntry, LedgerLine
from src.scripts.import_a5 import _clean, _money, _read

ZERO = Decimal("0")
(A_KEY, _A_DATE, A_ACC, _A_ACCNAME, A_IN, A_OUT, _A_DESC, _A_TYPE, _A_DOC,
 _A_VOUCHER, _A_CAT, _A_ID) = range(12)


def _src_vouchers(path: str, prefix: str):
    """sysfree -> Counter((acc_id, direction, amount)) + عدد السطور."""
    out: dict[str, list] = defaultdict(list)
    if not os.path.exists(path):
        return out
    for r in _read(path):
        if len(r) < 12:
            continue
        debit, credit = _money(r[A_IN]), _money(r[A_OUT])
        if debit == ZERO and credit == ZERO:
            continue
        out[f"a5:{prefix}{_clean(r[A_KEY])}"].append(
            (f"{prefix}A5S-{_clean(r[A_ACC])}",
             "debit" if credit <= debit else "credit",
             debit if credit <= debit else credit))
    return out


def run(*, aliaa_dir: str, oct_dir: str) -> None:
    src: dict[str, list] = {}
    for prefix, folder in (("AL-", aliaa_dir), ("", oct_dir)):
        src.update(_src_vouchers(os.path.join(folder, "a5_acclines.tsv"), prefix))

    db = SessionLocal()
    try:
        accs = {a.id: a.code for a in db.scalars(select(Account)).all()}
        stats: dict[str, int] = defaultdict(int)
        stale: list[tuple] = []
        differs: list[tuple] = []
        nosrc: list[tuple] = []
        for e in db.scalars(select(LedgerEntry).where(
                LedgerEntry.external_ref.like("a5:%"))).all():
            ref = e.external_ref
            slegs = src.get(ref)
            olines = db.scalars(select(LedgerLine).where(
                LedgerLine.entry_id == e.id)).all()
            oplegs = sorted((accs.get(ln.account_id), str(ln.direction).split(".")[-1],
                             Decimal(ln.amount)) for ln in olines)
            if slegs is None:
                stats["no-source"] += 1
                nosrc.append((e.id, ref, e.entry_type, str(e.entry_date)))
                continue
            slegs_n = sorted((code, d, Decimal(a)) for code, d, a in slegs)
            if oplegs == [(c, d, a) for c, d, a in slegs_n]:
                stats["match"] += 1
            else:
                stats["legs-differ"] += 1
                differs.append((e.id, ref, e.entry_type, str(e.entry_date), oplegs, slegs_n))
        # stale = no-source مع التأكد إن المرجع sysfree-style (a5:AL-123 أو a5:456)
        print(f"قيود بمرجع a5: match={stats['match']} legs-differ={stats['legs-differ']} no-source={stats['no-source']}")
        if differs:
            print(f"\n— legs-differ ({len(differs)}):")
            for eid, ref, typ, dt, oplegs, slegs_n in differs[:25]:
                print(f"   entry={eid} {ref} {typ} {dt}")
                print(f"      ours:   {[(c, d, f'{a:,.2f}') for c, d, a in oplegs]}")
                print(f"      a5 now: {[(c, d, f'{a:,.2f}') for c, d, a in slegs_n]}")
            if len(differs) > 25:
                print(f"   ... و{len(differs) - 25} غيرهم")
        if nosrc:
            print(f"\n— no-source ({len(nosrc)}): أول 25:")
            for eid, ref, typ, dt in nosrc[:25]:
                print(f"   entry={eid} {ref} {typ} {dt}")
            if len(nosrc) > 25:
                print(f"   ... و{len(nosrc) - 25} غيرهم")
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    aliaa = args[args.index("--aliaa-dir") + 1] if "--aliaa-dir" in args else "C:/pgtmp/aliaa"
    octd = args[args.index("--oct-dir") + 1] if "--oct-dir" in args else "C:/pgtmp"
    run(aliaa_dir=aliaa, oct_dir=octd)
