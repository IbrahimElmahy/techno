from __future__ import annotations

import json
import sys
from datetime import datetime
from decimal import Decimal

from sqlalchemy import text

from src.core.db import SessionLocal

SUPPLIER_PARENT_BY_BRANCH = {1: 6, 2: 1353, 3: 3818}


def rows(db, sql, **kw):
    return [dict(r._mapping) for r in db.execute(text(sql), kw).all()]


def main() -> None:
    execute = "--yes" in sys.argv[1:]
    out = sys.argv[sys.argv.index("--backup") + 1] if "--backup" in sys.argv else None
    db = SessionLocal()
    backup: dict = {}
    try:
        backup["naqrashi_link"] = rows(db, """
            select * from customer_account where customer_id = 1458 or account_id = 1608""")
        if not db.execute(text(
                "select 1 from customer_account where account_id = 1608")).first():
            db.execute(text("""
                insert into customer_account (customer_id, account_id, created_at)
                values (1458, 1608, now())"""))
            print("linked account 1608 to customer 1458")

        fc = rows(db, """
            with t as (
              select r.id, r.document_number, r.value, r.cash_refund, r.credit_reduction,
                coalesce(sum(case when ca.account_id is not null then
                  (case when l.direction::text like 'c%' then l.amount else -l.amount end) end), 0) ar
              from sales_return r
              join ledger_line l on l.entry_id = r.ledger_entry_id
              left join customer_account ca on ca.account_id = l.account_id
                                           and ca.customer_id = r.customer_id
              where r.customer_id is not null and r.credit_reduction = 0
              group by r.id)
            select * from t where ar > 0.009 and ar <= value + 0.05""")
        backup["returns"] = fc
        for r in fc:
            ar = min(Decimal(str(r["ar"])), Decimal(str(r["value"])))
            db.execute(text("""
                update sales_return set credit_reduction = :cr, cash_refund = value - :cr
                where id = :id"""), {"cr": ar, "id": r["id"]})
        print("returns fixed:", len(fc), sum(Decimal(str(r["ar"])) for r in fc))

        orphans = rows(db, """
            select a.id, a.parent_id, a.name, s.id supplier_id, s.name supplier,
              coalesce(s.branch_id, (select min(p.branch_id) from purchase_invoice p
                                     where p.supplier_id = s.id)) branch_id
            from supplier_account sa join supplier s on s.id = sa.supplier_id
            join account a on a.id = sa.account_id
            where a.parent_id is null and a.id in (4598, 4603)""")
        backup["orphan_accounts"] = orphans
        for a in orphans:
            parent = SUPPLIER_PARENT_BY_BRANCH.get(a["branch_id"])
            if parent:
                db.execute(text("update account set parent_id = :p where id = :id"),
                           {"p": parent, "id": a["id"]})
                print("account", a["id"], a["supplier"], "-> parent", parent)

        moves = rows(db, """
            select p.id, p.document_number, p.supplier_id, sa.supplier_id new_supplier
            from purchase_invoice p
            join ledger_line l on l.entry_id = p.ledger_entry_id and l.direction::text like 'c%'
            join supplier_account sa on sa.account_id = l.account_id
            where p.supplier_id in (36, 159) and sa.supplier_id in (163, 155)
              and not exists (select 1 from supplier_account x
                              where x.account_id = l.account_id and x.supplier_id = p.supplier_id)
              and ((p.supplier_id = 36 and sa.supplier_id = 163)
                   or (p.supplier_id = 159 and sa.supplier_id = 155))""")
        backup["purchase_moves"] = moves
        for m in moves:
            db.execute(text("update purchase_invoice set supplier_id = :s where id = :id"),
                       {"s": m["new_supplier"], "id": m["id"]})
        print("purchase invoices moved:", len(moves),
              sorted({(m["supplier_id"], m["new_supplier"]) for m in moves}))

        db.flush()
        if execute:
            if out:
                with open(out, "w", encoding="utf-8") as f:
                    json.dump(backup, f, ensure_ascii=False, default=str)
            db.commit()
            print("APPLIED", datetime.now().isoformat())
        else:
            db.rollback()
            print("DRY RUN")
    finally:
        db.close()


if __name__ == "__main__":
    main()
