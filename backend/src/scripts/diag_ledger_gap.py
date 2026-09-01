"""يقول بالظبط ليه سطور دفتر a5 ماوصلتش — سطر سطر، بالسبب.

    python -m src.scripts.diag_ledger_gap --dir C:/pgtmp
    python -m src.scripts.diag_ledger_gap --dir C:/pgtmp/aliaa --prefix AL-

قراءة بس — مابيكتبش حاجة. بيقرا نفس الملف اللي الاستيراد بيقراه وبيعدّ الصفوف
بنفس شروطه، فالفرق بين المصدر والقاعدة بيتفسّر برقم مش بتخمين.

الاستيراد بيتخطى صف لسببين: حسابه مش في شجرتنا، أو قيمته صفر على الجنبين. الأولاني
**فقدان حقيقي** — قيد ناقص طرف؛ والتاني صف فاضي مالوش أثر على أي رصيد.
"""
from __future__ import annotations

import sys
from collections import Counter

from sqlalchemy import select

from src.core.db import SessionLocal
from src.core.money import ZERO, to_money
from src.models.ledger import Account, LedgerEntry

# نفس أعمدة `import_a5_ledger` — أي تغيير هناك لازم يتنقل هنا.
A_KEY, A_DATE, A_ACC, A_ACCNAME = 0, 1, 2, 3
A_IN, A_OUT, A_DESC, A_CAT, A_TYPE, A_DOC = 4, 5, 6, 7, 8, 9


def _clean(s: str) -> str:
    return (s or "").strip()


def _money(s: str):
    try:
        return to_money(str(s).strip() or 0)
    except Exception:
        return ZERO


def run(folder: str, prefix: str) -> None:
    path = f"{folder}/a5_acclines.tsv"
    raw = open(path, encoding="utf-16-le").read()
    rows = [r.split("~") for r in raw.splitlines() if r.strip()][1:]
    print(f"الملف: {path}\nصفوف المصدر: {len(rows):,}\n")

    db = SessionLocal()
    try:
        acc_by_code = {
            a.code: a for a in db.scalars(select(Account).where(Account.code.is_not(None)))
        }
        refs = {
            r for (r,) in db.execute(
                select(LedgerEntry.external_ref).where(LedgerEntry.external_ref.is_not(None)))
        }

        missing_acc: Counter[str] = Counter()
        zero = 0
        ok = 0
        no_entry = 0
        no_entry_nonzero = 0
        for r in rows:
            if len(r) <= A_DOC:
                continue
            ref = f"a5:{prefix}{_clean(r[A_KEY])}"
            if ref not in refs:
                # القيد نفسه مادخلش. الاستيراد بيسيب القيد اللي كل سطوره صفر —
                # فالسؤال هنا: هل فيهم سطر بقيمة؟ ده اللي يبقى فقدان.
                no_entry += 1
                if _money(r[A_IN]) != ZERO or _money(r[A_OUT]) != ZERO:
                    no_entry_nonzero += 1
                continue
            code = f"{prefix}A5S-{_clean(r[A_ACC])}"
            if code not in acc_by_code:
                missing_acc[f"{_clean(r[A_ACCNAME])} ({code})"] += 1
                continue
            if _money(r[A_IN]) == ZERO and _money(r[A_OUT]) == ZERO:
                zero += 1
                continue
            ok += 1

        print(f"  المفروض دخلوا (قيمتهم مش صفر وحسابهم موجود) : {ok:>8,}")
        print(f"  صفر على الجنبين — مالهمش أثر على أي رصيد     : {zero:>8,}")
        print(f"  قيدهم نفسه مادخلش                           : {no_entry:>8,}")
        print(f"     منهم بقيمة (فقدان لو أكبر من صفر)        : {no_entry_nonzero:>8,}")
        print(f"  حسابهم مش في الشجرة — **فقدان حقيقي**       : "
              f"{sum(missing_acc.values()):>8,}")
        if missing_acc:
            print("\n  الحسابات الناقصة:")
            for name, n in missing_acc.most_common(20):
                print(f"     {name:<52}{n:>7,}")
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp"
    prefix = args[args.index("--prefix") + 1] if "--prefix" in args else ""
    run(folder, prefix)
