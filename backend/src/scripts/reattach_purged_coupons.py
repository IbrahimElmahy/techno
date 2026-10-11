from __future__ import annotations

import argparse
from decimal import Decimal

from sqlalchemy import text

from src.core.db import SessionLocal
from src.lib import arabic


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--branch", type=int, required=True)
    ap.add_argument("--prefix", required=True)
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args()
    db = SessionLocal()
    tag = f"_bak_purge_b{a.branch}_coupons"
    rows = db.execute(text(
        f"select b.id, b.inv_customer_id, b.inv_date, b.inv_net, b.inv_doc, b.coupon_type_id, "
        f"b.count, b.serial_from, b.serial_to, b.coupon_kind, c.name "
        f"from {tag} b left join customer c on c.id=b.inv_customer_id order by b.inv_date")).all()
    invoices = db.execute(text(
        "select i.id, i.customer_id, i.invoice_date, i.net, c.name from sales_invoice i "
        "join customer c on c.id=i.customer_id where i.branch_id=:b and i.document_number ~ :rx"),
        {"b": a.branch, "rx": f"^{a.prefix}S[0-9]+$"}).all()
    by_cust: dict[tuple, list] = {}
    by_name: dict[tuple, list] = {}
    for inv in invoices:
        by_cust.setdefault((inv.customer_id, inv.invoice_date), []).append(inv)
        by_name.setdefault((arabic.bare(inv.name or ""), inv.invoice_date), []).append(inv)

    placed = missing = 0
    for r in rows:
        cands = by_cust.get((r.inv_customer_id, r.inv_date)) \
            or by_name.get((arabic.bare(r.name or ""), r.inv_date)) or []
        if not cands:
            missing += 1
            print(f"   بلا مقابل: {r.inv_doc} {r.inv_date} {r.name} {r.coupon_kind} × {r.count}")
            continue
        net = Decimal(str(r.inv_net or 0))
        best = min(cands, key=lambda i: abs(Decimal(str(i.net or 0)) - net))
        exists = db.execute(text(
            "select 1 from sales_invoice_coupon where invoice_id=:i and coalesce(serial_from,'')="
            "coalesce(:sf,'') and coalesce(coupon_kind,'')=coalesce(:k,'')"),
            {"i": best.id, "sf": r.serial_from, "k": r.coupon_kind}).first()
        if exists:
            continue
        db.execute(text(
            "insert into sales_invoice_coupon (invoice_id, coupon_type_id, count, serial_from, "
            "serial_to, coupon_kind) values (:i, :t, :n, :sf, :st, :k)"),
            {"i": best.id, "t": r.coupon_type_id, "n": r.count, "sf": r.serial_from,
             "st": r.serial_to, "k": r.coupon_kind})
        placed += 1
    print(f"اترجع {placed} سطر كوبونات · بلا فاتورة مقابلة {missing}")
    if a.yes:
        db.commit()
        print("APPLIED")
    else:
        db.rollback()
        print("DRY RUN")


if __name__ == "__main__":
    main()
