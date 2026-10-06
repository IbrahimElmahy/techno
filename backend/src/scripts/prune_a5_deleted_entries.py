"""قيود a5 اللي اتمسحت من a5 بعد ما نقلناها — بتتشال من عندنا (٢٠٢٦-١٠-٠٦).

    python -m src.scripts.prune_a5_deleted_entries --dir /opt/techno/a5factory --branch السادات --prefix FC-
    python -m src.scripts.prune_a5_deleted_entries ... --yes

`rebuild_a5_ledger` بيعيد بناء القيد اللي **اتغيّر** في a5، بس القيد اللي **اتمسح** هناك بيفضل
عندنا للأبد. في السادات ٢٠٢٦-١٠-٠٦: سند ٩٬٠٠٠ على الخزنة (33926) وقيدين أمر تصنيع ٣٥٤٧
(33883/33884) — a5 مسحهم وعمل غيرهم، فالخزنة عندنا بقت ناقصة ٩٬٠٠٠ عن a5.

القيد بيتشال لو مرجعه `a5:<بادئة><sysfree>` ورقمه مش في التصدير (`a5_acclines.tsv`). المستند
المربوط بيه بيتفك ربطه الأول (`import_a5_ledger` بيربطه بقيده الجديد). مقفول على الفرع.
"""
from __future__ import annotations

import os
import sys

from sqlalchemy import text

from src.core.db import SessionLocal
from src.scripts.import_a5 import _clean, _read
from src.scripts.import_a5_ledger import A_KEY

LINKS = (("sales_invoice", "ledger_entry_id"), ("sales_return", "ledger_entry_id"),
         ("sales_return", "reversal_entry_id"), ("purchase_invoice", "ledger_entry_id"),
         ("purchase_return", "ledger_entry_id"), ("purchase_return", "reversal_entry_id"))


def run(folder: str, *, branch_name: str, prefix: str, execute: bool) -> int:
    rows = _read(os.path.join(folder, "a5_acclines.tsv"))
    if len(rows) < 100:
        print("⚠ التصدير فاضي أو ناقص — وقفت من غير ما أشيل حاجة.")
        return 1
    keys = {f"a5:{prefix}{_clean(r[A_KEY])}" for r in rows if r}
    db = SessionLocal()
    try:
        bid = db.execute(text("select id from branch where name=:n"), {"n": branch_name}).scalar_one()
        gone = [(i, ref, d, desc) for i, ref, d, desc in db.execute(text("""
            select id, external_ref, entry_date, description from ledger_entry
            where branch_id = :b and external_ref like :p"""),
            {"b": bid, "p": f"a5:{prefix}%"}).all() if ref not in keys]
        print(f"فرع {branch_name}: قيود اتمسحت من a5 {len(gone)}")
        for _i, ref, d, desc in gone:
            print(f"   {ref:<16} {d}  {(desc or '')[:70]}")
        if not execute or not gone:
            if gone:
                print("عرض فقط — `--yes` للتنفيذ.")
            return 0
        ids = [g[0] for g in gone]
        for t, col in LINKS:
            db.execute(text(f"update {t} set {col} = null where {col} = any(:i)"), {"i": ids})
        db.execute(text("""delete from partial_reconcile where debit_line_id in
            (select id from ledger_line where entry_id = any(:i)) or credit_line_id in
            (select id from ledger_line where entry_id = any(:i))"""), {"i": ids})
        db.execute(text("delete from ledger_line where entry_id = any(:i)"), {"i": ids})
        db.execute(text("delete from ledger_entry where id = any(:i)"), {"i": ids})
        db.commit()
        print(f"✔ اتشال {len(ids)} قيد — في {branch_name} بس.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    a = sys.argv[1:]
    folder = a[a.index("--dir") + 1] if "--dir" in a else ""
    prefix = a[a.index("--prefix") + 1] if "--prefix" in a else ""
    branch = a[a.index("--branch") + 1] if "--branch" in a else ""
    if not folder or not branch or not prefix:
        print("لازم --dir و--branch و--prefix.")
        sys.exit(2)
    sys.exit(run(folder, branch_name=branch, prefix=prefix, execute="--yes" in a))
