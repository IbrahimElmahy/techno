from __future__ import annotations

import json
import sys

from sqlalchemy import text

from src.core.db import SessionLocal

PAIRS = {148: 3763, 149: 3822, 150: 3811}


def rows(db, sql, **kw):
    return [dict(r._mapping) for r in db.execute(text(sql), kw).all()]


def main() -> None:
    execute = "--yes" in sys.argv[1:]
    out = sys.argv[sys.argv.index("--backup") + 1] if "--backup" in sys.argv else None
    db = SessionLocal()
    backup = {
        "supplier_account": rows(db, "select * from supplier_account where supplier_id = any(:s)",
                                 s=list(PAIRS)),
        "moved_lines": [],
    }
    try:
        for sid, cid in PAIRS.items():
            accts = [r["account_id"] for r in rows(
                db, "select account_id from customer_account where customer_id = :c", c=cid)]
            if len(accts) != 1:
                raise SystemExit(f"customer {cid} has {len(accts)} accounts")
            shared = accts[0]
            old = rows(db, "select id, account_id from supplier_account where supplier_id = :s",
                       s=sid)
            for o in old:
                if o["account_id"] == shared:
                    continue
                lines = rows(db, "select id from ledger_line where account_id = :a",
                             a=o["account_id"])
                backup["moved_lines"].append({"from": o["account_id"], "to": shared,
                                              "ids": [r["id"] for r in lines]})
                db.execute(text("update ledger_line set account_id = :to where account_id = :a"),
                           {"to": shared, "a": o["account_id"]})
                db.execute(text("update supplier_account set account_id = :to where id = :id"),
                           {"to": shared, "id": o["id"]})
                db.execute(text("update account set active = false where id = :a"),
                           {"a": o["account_id"]})
                print("supplier", sid, "account", o["account_id"], "->", shared,
                      "lines moved:", len(lines))
            if not old:
                db.execute(text("insert into supplier_account (supplier_id, account_id) "
                                "values (:s, :a)"), {"s": sid, "a": shared})
                print("supplier", sid, "linked to", shared)
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
