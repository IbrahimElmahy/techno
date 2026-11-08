from __future__ import annotations

import sys

from sqlalchemy import text

from src.core.db import SessionLocal

PLAN = text("""
    select l.id, p.document_number, l.quantity, l.unit_price, l.line_total
      from purchase_invoice_line l join purchase_invoice p on p.id = l.invoice_id
     where l.quantity <> 0
       and coalesce(l.discount_pct, 0) = 0 and coalesce(l.fixed_discount_pct, 0) = 0
       and coalesce(l.variable_discount_pct, 0) = 0
       and abs(round(l.quantity * l.unit_price, 2) - l.line_total) >= 0.01
""")


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        rows = db.execute(PLAN).all()
        for lid, doc, qty, price, total in rows:
            db.execute(text("update purchase_invoice_line set unit_price = round(line_total / quantity, 6)"
                            " where id = :i"), {"i": lid})
            print(f"{doc}: {qty} × {price} → {total}")
        print(f"سطور: {len(rows)}")
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
