from __future__ import annotations

import sys

from sqlalchemy import text

from src.core.db import SessionLocal

PLAN = text("""
    select r.id, r.document_number, r.value,
           coalesce(sum(l.amount) filter (where l.direction::text = 'credit'
                    and a.account_type::text in ('treasury', 'custody')), 0)
         - coalesce(sum(l.amount) filter (where l.direction::text = 'debit'
                    and a.account_type::text in ('treasury', 'custody')), 0) as cash
      from sales_return r
      join ledger_line l on l.entry_id = r.ledger_entry_id
      join account a on a.id = l.account_id
     where (r.document_number like 'AL-SR%' or r.document_number ~ '^SR[0-9]')
       and r.cash_refund = 0 and r.credit_reduction = 0
     group by r.id, r.document_number, r.value
""")


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        rows = db.execute(PLAN).all()
        cash_total = credit_total = 0
        for rid, _doc, value, cash in rows:
            credit = value - cash
            cash_total += cash
            credit_total += credit
            db.execute(text("update sales_return set cash_refund = :c, credit_reduction = :r"
                            " where id = :i"), {"c": cash, "r": credit, "i": rid})
        print(f"مرتجعات: {len(rows)} — نقدي {cash_total:.2f} — على الحساب {credit_total:.2f}")
        if execute:
            db.commit()
            print("تم الحفظ.")
        else:
            db.rollback()
            print("تجربة فقط — أضف --yes للحفظ.")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
