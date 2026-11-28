from __future__ import annotations

import json
import sys

from sqlalchemy import text

from src.core.db import SessionLocal

USER_ID = 89
BRANCH = 2
SINCE = "2026-11-26"


def main() -> None:
    execute = "--yes" in sys.argv[1:]
    out = sys.argv[sys.argv.index("--backup") + 1] if "--backup" in sys.argv else None
    db = SessionLocal()
    try:
        rows = db.execute(text(
            "select id, document_number, ledger_entry_id from voucher where branch_id is null "
            "and actor_user_id = :u and created_at >= :s"), {"u": USER_ID, "s": SINCE}).all()
        vids = [r.id for r in rows]
        eids = [r.ledger_entry_id for r in rows if r.ledger_entry_id]
        print("vouchers:", len(vids), "entries:", len(eids))
        db.execute(text("update voucher set branch_id = :b where id = any(:i) and branch_id is null"),
                   {"b": BRANCH, "i": vids})
        db.execute(text("update ledger_entry set branch_id = :b where id = any(:i) and branch_id is null"),
                   {"b": BRANCH, "i": eids})
        if execute:
            if out:
                with open(out, "w", encoding="utf-8") as f:
                    json.dump({"vouchers": vids, "entries": eids}, f)
            db.commit()
            print("APPLIED")
        else:
            db.rollback()
            print("DRY RUN")
    finally:
        db.close()


if __name__ == "__main__":
    main()
