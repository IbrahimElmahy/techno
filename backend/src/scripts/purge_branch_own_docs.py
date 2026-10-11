from __future__ import annotations

import argparse

from sqlalchemy import text

from src.core.db import SessionLocal


def _ids(db, sql: str, **kw) -> list[int]:
    return [r[0] for r in db.execute(text(sql), kw).all()]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--branch", type=int, required=True)
    ap.add_argument("--prefix", required=True)
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args()
    db = SessionLocal()
    b, p = a.branch, a.prefix

    si = _ids(db, "select id from sales_invoice where branch_id=:b and document_number !~ :rx",
              b=b, rx=f"^{p}S[0-9]+$")
    sr = _ids(db, "select id from sales_return where branch_id=:b and document_number !~ :rx",
              b=b, rx=f"^{p}SR[0-9]+$")
    pi = _ids(db, "select id from purchase_invoice where branch_id=:b and document_number !~ :rx",
              b=b, rx=f"^{p}P[0-9]+$")
    pr = _ids(db, "select id from purchase_return where branch_id=:b and document_number !~ :rx",
              b=b, rx=f"^{p}PR[0-9]+$")
    tr = _ids(db, "select id from stock_transfer where branch_id=:b and document_number !~ :rx",
              b=b, rx=f"^{p}T[0-9]+$")
    sp = _ids(db, """select s.id from stock_permit s join warehouse w on w.id=s.warehouse_id
                     where w.branch_id=:b and s.document_number !~ :rx""",
              b=b, rx=f"^{p}(RC|IS)[0-9]+$")
    en = _ids(db, """select id from ledger_entry where branch_id=:b
                     and (external_ref is null or external_ref not like 'a5:%')
                     and entry_type <> 'opening_balance'""", b=b)
    vo = _ids(db, "select id from voucher where ledger_entry_id = any(:e)", e=en)
    print(f"بيع {len(si)} · مرتجع بيع {len(sr)} · شراء {len(pi)} · مرتجع شراء {len(pr)} · "
          f"تحويلات {len(tr)} · أذونات {len(sp)} · سندات {len(vo)} · قيود {len(en)}")

    blockers = db.execute(text("""
        select 'cheque', count(*) from cheque
            where register_entry_id = any(:e) or settle_entry_id = any(:e)
        union all select 'advance', count(*) from employee_advance
            where ledger_entry_id = any(:e) or reversal_entry_id = any(:e)
        union all select 'payroll', count(*) from payroll_line where payment_entry_id = any(:e)
        union all select 'asset', count(*) from depreciation_record where ledger_entry_id = any(:e)
        union all select 'redemption', count(*) from coupon_redemption
            where ledger_entry_id = any(:e) or sales_invoice_id = any(:s)"""),
        {"e": en, "s": si}).all()
    bad = [(k, n) for k, n in blockers if n]
    if bad:
        raise SystemExit(f"مستندات مرتبطة لازم تتراجع يدوياً: {bad}")

    mv = _ids(db, """select id from stock_movement where
        (source_doc_type='sales_invoice' and source_doc_id = any(:si))
        or (source_doc_type='sales_return' and source_doc_id = any(:sr))
        or (source_doc_type='purchase_invoice' and source_doc_id = any(:pi))
        or (source_doc_type='purchase_return' and source_doc_id = any(:pr))
        or (source_doc_type='stock_transfer' and source_doc_id = any(:tr))
        or (source_doc_type='stock_permit' and source_doc_id = any(:sp))""",
              si=si, sr=sr, pi=pi, pr=pr, tr=tr, sp=sp)
    print(f"حركات مخزون {len(mv)}")

    tag = f"_bak_purge_b{b}_coupons"
    steps = [
        (f"create table if not exists {tag} as select c.*, i.customer_id as inv_customer_id, "
         "i.invoice_date as inv_date, i.net as inv_net, i.gross as inv_gross, "
         "i.document_number as inv_doc, i.is_bonus as inv_bonus from sales_invoice_coupon c "
         "join sales_invoice i on i.id=c.invoice_id where false", {}),
        (f"insert into {tag} select c.*, i.customer_id, i.invoice_date, i.net, i.gross, "
         "i.document_number, i.is_bonus from sales_invoice_coupon c "
         "join sales_invoice i on i.id=c.invoice_id where i.id = any(:si)", {"si": si}),
        ("update sales_return set sales_invoice_id=null where sales_invoice_id = any(:si)",
         {"si": si}),
        ("update purchase_return set purchase_invoice_id=null where purchase_invoice_id = any(:pi)",
         {"pi": pi}),
        ("update sales_invoice set bonus_for_invoice_id=null where bonus_for_invoice_id = any(:si)",
         {"si": si}),
        ("update sales_invoice set ledger_entry_id=null where id = any(:si)", {"si": si}),
        ("update sales_return set ledger_entry_id=null, reversal_entry_id=null where id = any(:sr)",
         {"sr": sr}),
        ("update purchase_invoice set ledger_entry_id=null where id = any(:pi)", {"pi": pi}),
        ("update purchase_return set ledger_entry_id=null, reversal_entry_id=null "
         "where id = any(:pr)", {"pr": pr}),
        ("delete from point_record where sales_invoice_id = any(:si) or sales_return_id = any(:sr)",
         {"si": si, "sr": sr}),
        ("delete from sales_invoice_coupon where invoice_id = any(:si)", {"si": si}),
        ("delete from sales_invoice_expense where invoice_id = any(:si)", {"si": si}),
        ("update coupon_receipt_line set sales_invoice_id=null where sales_invoice_id = any(:si)",
         {"si": si}),
        ("update reservation set sales_invoice_id=null where sales_invoice_id = any(:si)",
         {"si": si}),
        ("update item_serial set sold_invoice_id=null where sold_invoice_id = any(:si)",
         {"si": si}),
        ("update stock_transfer set out_movement_id=null, in_movement_id=null where id = any(:tr)",
         {"tr": tr}),
        ("update stock_permit_line set stock_movement_id=null where stock_movement_id = any(:m)",
         {"m": mv}),
        ("delete from stock_movement where reverses_movement_id = any(:m)", {"m": mv}),
        ("delete from stock_movement where id = any(:m)", {"m": mv}),
        ("delete from sales_invoice_line where invoice_id = any(:si)", {"si": si}),
        ("delete from sales_invoice where id = any(:si)", {"si": si}),
        ("delete from sales_return_line where return_id = any(:sr)", {"sr": sr}),
        ("delete from sales_return where id = any(:sr)", {"sr": sr}),
        ("delete from purchase_return_line where return_id = any(:pr)", {"pr": pr}),
        ("delete from purchase_return where id = any(:pr)", {"pr": pr}),
        ("delete from purchase_invoice_line where invoice_id = any(:pi)", {"pi": pi}),
        ("delete from purchase_invoice where id = any(:pi)", {"pi": pi}),
        ("delete from stock_transfer_line where transfer_id = any(:tr)", {"tr": tr}),
        ("delete from stock_transfer where id = any(:tr)", {"tr": tr}),
        ("delete from stock_permit_line where permit_id = any(:sp)", {"sp": sp}),
        ("delete from stock_permit where id = any(:sp)", {"sp": sp}),
        ("update voucher set reverses_id=null where reverses_id = any(:v)", {"v": vo}),
        ("delete from voucher where id = any(:v)", {"v": vo}),
        ("update ledger_entry set reverses_entry_id=null where reverses_entry_id = any(:e)",
         {"e": en}),
        ("delete from ledger_line where entry_id = any(:e)", {"e": en}),
        ("delete from ledger_entry where id = any(:e)", {"e": en}),
    ]
    for sql, kw in steps:
        r = db.execute(text(sql), kw)
        n = r.rowcount if r.rowcount is not None else "-"
        print(f"   {n:>6}  {sql[:80]}")
    if a.yes:
        db.commit()
        print("APPLIED")
    else:
        db.rollback()
        print("DRY RUN")


if __name__ == "__main__":
    main()
