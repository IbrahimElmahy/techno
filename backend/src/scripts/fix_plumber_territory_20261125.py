from __future__ import annotations

import json
import re
import sys
from collections import Counter

from sqlalchemy import text

from src.core.db import SessionLocal


def norm(s: str | None) -> str:
    s = re.sub(r"[أإآٱ]", "ا", s or "")
    s = s.replace("ة", "ه").replace("ى", "ي")
    return re.sub(r"\s+", " ", s).strip()


def main() -> None:
    execute = "--yes" in sys.argv[1:]
    out = sys.argv[sys.argv.index("--backup") + 1] if "--backup" in sys.argv else None
    db = SessionLocal()
    try:
        wrong = {r.id: r.branch_id for r in db.execute(text(
            "select id, branch_id from territory where name = 'الاسكندرية'")).all()}
        terr = {}
        for r in db.execute(text("select id, name, branch_id from territory")).all():
            terr.setdefault((r.branch_id, norm(r.name)), r.id)
        rows = db.execute(text(
            "select id, territory_id, markaz from customer where customer_type = 'plumber' "
            "and territory_id = any(:w)"), {"w": list(wrong)}).all()
        moves, missing = [], Counter()
        for r in rows:
            target = terr.get((wrong[r.territory_id], norm(r.markaz))) if r.markaz else None
            if target and target != r.territory_id:
                moves.append({"id": r.id, "from": r.territory_id, "to": target})
            else:
                missing[r.markaz or "بلا مدينة"] += 1
        print("plumbers on Alexandria:", len(rows), "to move:", len(moves))
        print("left as is:", missing.most_common(15))
        for m in moves:
            db.execute(text("update customer set territory_id = :t where id = :i"),
                       {"t": m["to"], "i": m["id"]})
        if execute:
            if out:
                with open(out, "w", encoding="utf-8") as f:
                    json.dump(moves, f)
            db.commit()
            print("APPLIED")
        else:
            db.rollback()
            print("DRY RUN")
    finally:
        db.close()


if __name__ == "__main__":
    main()
