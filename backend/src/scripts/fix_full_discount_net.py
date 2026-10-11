from __future__ import annotations

import sys

from sqlalchemy import text

from src.core.db import SessionLocal

WHERE = "combined_pct >= 100 and net <> 0"


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        rows = db.execute(text(
            f"select branch_id, count(*), coalesce(sum(net), 0) from sales_invoice where {WHERE} "
            "group by 1 order by 1")).all()
        for b, n, total in rows:
            print(f"فرع {b}: {n} فاتورة خصمها ١٠٠٪ وصافيها مسجّل {total:,.2f}")
        if not execute:
            print("عرض فقط — أضف --yes للتنفيذ.")
            return
        db.execute(text(
            "create table if not exists _bak_full_discount_net as "
            "select id, net, now() as saved_at from sales_invoice where false"))
        db.execute(text(
            "insert into _bak_full_discount_net "
            f"select id, net, now() from sales_invoice where {WHERE}"))
        n = db.execute(text(f"update sales_invoice set net = 0 where {WHERE}")).rowcount
        db.commit()
        print(f"اتصلّح {n} فاتورة — الصافي صفر زي a5. النسخة في _bak_full_discount_net")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv)
