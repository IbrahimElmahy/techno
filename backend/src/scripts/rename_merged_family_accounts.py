from __future__ import annotations

import sys

from sqlalchemy import text

from src.core.db import SessionLocal

QUERY = """
select a.id, a.name as old, c.name as cust, ca.family, c.branch_id
from customer_account ca
join customer c on c.id = ca.customer_id
join account a on a.id = ca.account_id
where ca.family is not null
  and ((a.name like 'تكنو%' and c.name not like 'تكنو%')
       or (a.name like '%وايت%' and c.name not like '%وايت%'))
order by c.branch_id, c.name
"""


def main() -> None:
    execute = "--yes" in sys.argv[1:]
    db = SessionLocal()
    try:
        rows = db.execute(text(QUERY)).all()
        for r in rows[:15]:
            print(f"{r.branch_id} | {r.old}  ←  {r.cust} {r.family}")
        print(f"إجمالي: {len(rows)}")
        for r in rows:
            db.execute(text("update account set name = :n where id = :i"),
                       {"n": f"{' '.join(r.cust.split())} {r.family}"[:160], "i": r.id})
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
