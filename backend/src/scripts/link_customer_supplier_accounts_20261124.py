from __future__ import annotations

import json
import sys

from sqlalchemy import text

from src.core.db import SessionLocal
from src.services.customer_merge_service import MERGED_MARK, _move_documents

LINKS = {3841: 140, 3846: 132, 3840: 64, 3843: 143, 3838: 113, 3839: 73, 3842: 63,
         3847: 118, 2057: 2}
MERGES = {4675: 2058, 4689: 2020}


def rows(db, sql, **kw):
    return [dict(r._mapping) for r in db.execute(text(sql), kw).all()]


def supplier_account(db, supplier_id: int) -> int:
    ids = [r["account_id"] for r in rows(
        db, "select account_id from supplier_account where supplier_id = :s", s=supplier_id)]
    if len(ids) != 1:
        raise SystemExit(f"supplier {supplier_id} has {len(ids)} accounts")
    return ids[0]


def main() -> None:
    execute = "--yes" in sys.argv[1:]
    out = sys.argv[sys.argv.index("--backup") + 1] if "--backup" in sys.argv else None
    db = SessionLocal()
    ids = list(LINKS) + list(MERGES) + list(MERGES.values())
    backup = {
        "customers": rows(db, "select * from customer where id = any(:ids)", ids=ids),
        "customer_accounts": rows(
            db, "select * from customer_account where customer_id = any(:ids)", ids=ids),
    }
    try:
        for cid, sid in LINKS.items():
            acct = supplier_account(db, sid)
            if rows(db, "select 1 from customer_account where account_id = :a", a=acct):
                print("skip", cid, "account", acct, "already linked")
                continue
            if rows(db, "select 1 from customer_account where customer_id = :c", c=cid):
                print("skip", cid, "has its own account")
                continue
            db.execute(text("insert into customer_account (customer_id, account_id, created_at) "
                            "values (:c, :a, now())"), {"c": cid, "a": acct})
            db.execute(text("update customer set supplier_id = coalesce(supplier_id, :s) "
                            "where id = :c"), {"s": sid, "c": cid})
            print("linked customer", cid, "-> supplier", sid, "account", acct)

        for dupe, keep in MERGES.items():
            sup = db.execute(text("select supplier_id from customer where id = :d"),
                             {"d": dupe}).scalar()
            db.execute(text("update customer_account set customer_id = :k "
                            "where customer_id = :d"), {"k": keep, "d": dupe})
            db.execute(text("update customer set supplier_id = coalesce(supplier_id, :s) "
                            "where id = :k"), {"s": sup, "k": keep})
            db.execute(text("update customer set supplier_id = null, active = false, "
                            "name = name || :mark where id = :d"),
                       {"d": dupe, "mark": f" {MERGED_MARK}{keep})"})
            moved = _move_documents(db, {dupe: keep})
            print("merged", dupe, "into", keep, moved)

        db.flush()
        if execute:
            if out:
                with open(out, "w", encoding="utf-8") as f:
                    json.dump(backup, f, ensure_ascii=False, default=str)
            db.commit()
            print("APPLIED")
        else:
            db.rollback()
            print("DRY RUN")
    finally:
        db.close()


if __name__ == "__main__":
    main()
