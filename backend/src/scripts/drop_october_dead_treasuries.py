from __future__ import annotations

import sys
from decimal import Decimal

from sqlalchemy import text

from src.core.db import SessionLocal
from src.services import account_resolver

CODES = ("A5S-1", "A5S-163")
BRANCH = 1
STATEMENT = "حذف خزينة المركز الرئيسى وخزينة المهندس احمد"


def main() -> None:
    execute = "--yes" in sys.argv[1:]
    db = SessionLocal()
    try:
        accs = db.execute(text(
            "select id, code, name from account where branch_id = :b and code = any(:c)"),
            {"b": BRANCH, "c": list(CODES)}).all()
        if len(accs) != len(CODES):
            print("الحسابات مش موجودة أو اتحذفت قبل كده:", accs)
            return
        ids = [a.id for a in accs]
        lines = db.execute(text(
            "select l.id, l.entry_id, l.account_id, l.direction, l.amount, e.entry_type "
            "from ledger_line l join ledger_entry e on e.id = l.entry_id "
            "where l.account_id = any(:ids)"), {"ids": ids}).all()
        for a in accs:
            print(f"{a.code:<10} {a.name}")
        for ln in lines:
            print(f"   سطر #{ln.id} قيد #{ln.entry_id} {ln.entry_type} {ln.direction} {ln.amount:,.2f}")
        if any(ln.entry_type != "opening_balance" for ln in lines):
            print("فيه حركة غير الافتتاحي — وقف.")
            return
        entries = {ln.entry_id for ln in lines}
        if len(entries) != 1:
            print("أكتر من قيد افتتاحي — وقف.")
            return
        entry_id = entries.pop()
        net = sum((Decimal(ln.amount) if ln.direction == "debit" else -Decimal(ln.amount)
                   for ln in lines), Decimal("0"))
        eq = account_resolver.opening_balance_equity_account(db, branch_id=BRANCH)
        print(f"صافي الرصيد المحذوف: {net:,.2f} ← على «{eq.name}» (#{eq.id})")

        line_ids = [ln.id for ln in lines]
        dist = db.execute(text(
            "select count(*) from ledger_line_distribution where line_id = any(:l)"),
            {"l": line_ids}).scalar() or 0
        if dist:
            db.execute(text("delete from ledger_line_distribution where line_id = any(:l)"),
                       {"l": line_ids})
        db.execute(text("delete from ledger_line where id = any(:l)"), {"l": line_ids})
        if net:
            db.execute(text(
                "insert into ledger_line (entry_id, account_id, direction, amount, statement) "
                "values (:e, :a, :d, :m, :s)"),
                {"e": entry_id, "a": eq.id, "d": "debit" if net > 0 else "credit",
                 "m": abs(net), "s": STATEMENT})
        db.execute(text("delete from account where id = any(:ids)"), {"ids": ids})

        diff = db.execute(text(
            "select coalesce(sum(case when direction='debit' then amount else -amount end),0) "
            "from ledger_line where entry_id = :e"), {"e": entry_id}).scalar()
        print(f"فرق القيد الافتتاحي بعد التعديل: {diff}")
        if diff != 0:
            db.rollback()
            print("القيد مش متوازن — اترجع.")
            return
        if execute:
            db.commit()
            print("APPLIED")
        else:
            db.rollback()
            print("DRY RUN")
    finally:
        db.close()


if __name__ == "__main__":
    main()
