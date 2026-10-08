from __future__ import annotations

import sys
from decimal import Decimal

from sqlalchemy import text, delete as sa_delete
from sqlalchemy import select, update as sa_update

from src.core.db import SessionLocal
from src.models.ledger import Direction, LedgerEntry, LedgerLine
from src.models.purchasing import PurchaseInvoice, PurchaseReturn
from src.models.sales import SalesInvoice, SalesReturn
from src.scripts.audit_a5_ledger_drift import TOL, theirs

ZERO = Decimal("0")

LINKED = (SalesInvoice, SalesReturn, PurchaseInvoice, PurchaseReturn)


def run(folder: str, *, branch_name: str, prefix: str, execute: bool,
        amounts_only: bool = False) -> int:
    db = SessionLocal()
    try:
        src = theirs(folder)
        if not src:
            print(f"مافيش a5_acclines.tsv في {folder} — شغّل التصدير الأول.")
            return 2

        tag = f"a5:{prefix}"
        mine: dict[str, LedgerEntry] = {}
        for e in db.scalars(select(LedgerEntry).where(
                LedgerEntry.external_ref.is_not(None))).all():
            ref = str(e.external_ref or "")
            if ref.startswith(tag):
                key = ref[len(tag):]
                if not prefix and not key.isdigit():
                    continue
                mine[key] = e

        drifted: list[tuple[str, LedgerEntry, Decimal, Decimal]] = []
        for key, want in src.items():
            e = mine.get(key)
            if e is None:
                continue
            lines = db.scalars(select(LedgerLine).where(
                LedgerLine.entry_id == e.id)).all()
            got = sum((Decimal(str(l.amount or 0)) for l in lines
                       if l.direction == Direction.debit), ZERO)
            got_cr = sum((Decimal(str(l.amount or 0)) for l in lines
                          if l.direction == Direction.credit), ZERO)
            if amounts_only:
                drift = abs(max(got, got_cr) - max(want["amount"], want["credit"])) > TOL
            else:
                drift = (abs(got - want["amount"]) > TOL
                         or abs(got_cr - want["credit"]) > TOL
                         or len(lines) != want["rows"])
            if drift:
                drifted.append((key, e, max(want["amount"], want["credit"]),
                                max(got, got_cr)))

        if not drifted:
            print("مافيش قيد مبلغه اتغيّر — كله مطابق للتصدير.")
            return 0

        gap = sum((w - g for _k, _e, w, g in drifted), ZERO)
        print(f"قيود هتتعاد: {len(drifted)}   (فرق a5 − عندنا: {gap})\n")
        print(f"{'مفتاح a5':<12}{'قيدنا':<9}{'a5':>16}{'عندنا':>16}{'الفرق':>14}")
        print("-" * 68)
        for key, e, want, got in sorted(drifted, key=lambda x: -abs(x[2] - x[3])):
            print(f"{key:<12}{e.id:<9}{want:>16}{got:>16}{want - got:>14}")

        if not execute:
            print("\nدرايَ-رن. `--yes` عشان ينفّذ.")
            print("وبعده شغّل `import_a5_ledger` عشان يبنيها من أول وجديد.")
            return 0

        ids = [e.id for _k, e, _w, _g in drifted]
        unlinked = 0
        for cls in LINKED:
            res = db.execute(sa_update(cls)
                             .where(cls.ledger_entry_id.in_(ids))
                             .values(ledger_entry_id=None))
            unlinked += res.rowcount or 0
        db.flush()
        db.execute(text("delete from voucher where ledger_entry_id = any(:i) and client_uuid like 'a5:%'"),
                   {"i": ids})
        db.execute(text("update voucher set ledger_entry_id = null where ledger_entry_id = any(:i)"),
                   {"i": ids})
        db.execute(text("""delete from partial_reconcile where debit_line_id in
            (select id from ledger_line where entry_id = any(:i)) or credit_line_id in
            (select id from ledger_line where entry_id = any(:i))"""), {"i": ids})
        db.execute(text("""delete from ledger_line_distribution where line_id in
            (select id from ledger_line where entry_id = any(:i))"""), {"i": ids})
        db.execute(sa_delete(LedgerLine).where(LedgerLine.entry_id.in_(ids)))
        db.execute(sa_delete(LedgerEntry).where(LedgerEntry.id.in_(ids)))
        db.commit()
        print(f"\nاتشال {len(ids)} قيد، واتفك ربط {unlinked} مستند.")
        print("شغّل `import_a5_ledger` دلوقتي — هيبنيها من أول وجديد ويربطها بمستنداتها.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp"
    prefix = args[args.index("--prefix") + 1] if "--prefix" in args else ""
    branch = args[args.index("--branch") + 1] if "--branch" in args else ""
    sys.exit(run(folder, branch_name=branch, prefix=prefix, execute="--yes" in args,
                 amounts_only="--amounts-only" in args))
