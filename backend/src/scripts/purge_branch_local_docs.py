from __future__ import annotations

import argparse

from sqlalchemy import text

from src.core.db import SessionLocal


def _ids(db, sql: str, **kw) -> list[int]:
    return [r[0] for r in db.execute(text(sql), kw).all()]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--branch", type=int, required=True)
    ap.add_argument("--also", nargs="*", default=[], help="أرقام مستندات a5 تتشال ليُعاد استيرادها")
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args()
    db = SessionLocal()
    b = a.branch

    sales = _ids(db, "select id from sales_invoice where branch_id=:b and document_number !~ '^S[0-9]+$'", b=b)
    rets = _ids(db, "select id from sales_return where branch_id=:b and document_number !~ '^SR[0-9]+$'", b=b)
    buys = _ids(db, "select id from purchase_invoice where branch_id=:b and document_number !~ '^P[0-9]+$'", b=b)
    trfs = _ids(db, "select id from stock_transfer where branch_id=:b and (document_number !~ '^T[0-9]+$' or document_number = any(:also))", b=b, also=a.also)
    vouchers = _ids(db, """select v.id from voucher v join ledger_entry e on e.id=v.ledger_entry_id
                           where e.branch_id=:b and (e.external_ref is null or e.external_ref not like 'a5:%')""", b=b)
    loose = _ids(db, """select e.id from ledger_entry e where e.branch_id=:b
                        and (e.external_ref is null or e.external_ref not like 'a5:%')
                        and e.entry_type not in ('opening_balance')""", b=b)
    print(f"فواتير بيع {len(sales)} · مرتجع بيع {len(rets)} · شراء {len(buys)} · تحويلات {len(trfs)} "
          f"· سندات {len(vouchers)} · قيود {len(loose)}")
    if rets or buys:
        raise SystemExit("فيه مرتجعات أو مشتريات من نظامنا — السكربت ده مش معمول ليها")

    mv_sales = _ids(db, "select id from stock_movement where source_doc_type='sales_invoice' and source_doc_id = any(:i)", i=sales)
    mv_trf = _ids(db, "select id from stock_movement where source_doc_type='stock_transfer' and source_doc_id = any(:i)", i=trfs)
    print(f"حركات مخزون: بيع {len(mv_sales)} · تحويل {len(mv_trf)}")

    steps = [
        ("update sales_invoice set ledger_entry_id=null where id = any(:s)", {"s": sales}),
        ("delete from point_record where sales_invoice_id = any(:s)", {"s": sales}),
        ("delete from sales_invoice_coupon where invoice_id = any(:s)", {"s": sales}),
        ("delete from sales_invoice_expense where invoice_id = any(:s)", {"s": sales}),
        ("update coupon_receipt_line set sales_invoice_id=null where sales_invoice_id = any(:s)", {"s": sales}),
        ("delete from sales_invoice_line where invoice_id = any(:s)", {"s": sales}),
        ("delete from stock_movement where id = any(:m)", {"m": mv_sales}),
        ("delete from sales_invoice where id = any(:s)", {"s": sales}),
        ("update stock_transfer set out_movement_id=null, in_movement_id=null where id = any(:t)", {"t": trfs}),
        ("delete from stock_movement where reverses_movement_id = any(:m)", {"m": mv_trf}),
        ("delete from stock_movement where id = any(:m)", {"m": mv_trf}),
        ("delete from stock_transfer_line where transfer_id = any(:t)", {"t": trfs}),
        ("delete from stock_transfer where id = any(:t)", {"t": trfs}),
        ("delete from voucher where id = any(:v)", {"v": vouchers}),
        ("delete from ledger_line where entry_id = any(:e)", {"e": loose}),
        ("delete from ledger_entry where id = any(:e)", {"e": loose}),
    ]
    for sql, kw in steps:
        r = db.execute(text(sql), kw)
        print(f"   {r.rowcount:>5}  {sql[:70]}")
    if a.yes:
        db.commit()
        print("APPLIED")
    else:
        db.rollback()
        print("DRY RUN")


if __name__ == "__main__":
    main()
