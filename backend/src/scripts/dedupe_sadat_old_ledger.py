"""قيود السادات القديمة المكرّرة — بتتشال (٢٠٢٦-١٠-٠٥).

أول نقل للسادات (٢٠٢٦-٠٩-٢٠) كتب قيود a5 بمرجع `a5:FC-<نوع>/<رقم>` ومن غير السندات
والقيود الحرة كلها (١٬٩٩٦ قيد من ٥٬٢٦٢). السلسلة الكاملة اللي اتضافت للمصنع (نفس العلياء
وأكتوبر) كتبتهم تاني بالمرجع المعتمد `a5:FC-<sysfree>` — كاملين ومطابقين لـa5. والقديم ماتعرفش
عليه لأن شكل المرجع مختلف، فبقى كل حاجة في السادات متقيّدة مرتين.

السكربت بيشيل القديم (اللي مرجعه فيه `/`) بس:
* المستندات اللي بتشاور عليه بيتفك ربطها (`ledger_entry_id = NULL`) — و`import_a5_ledger`
  بعده بيربطها بالقيد الجديد بتاعها.
* تسويات السداد اللي على سطوره بتتشال (الجديد بيتسوّى من أوله).
* القيد وسطوره.

عرض فقط افتراضياً؛ `--yes` للتنفيذ. وفي الحالتين بيطبع أرصدة عملاء وموردين السادات قبل
وبعد — بعد = رصيد a5.
"""
from __future__ import annotations

import argparse

from sqlalchemy import text

from src.core.db import SessionLocal

OLD = "select id from ledger_entry where external_ref like 'a5:FC-%/%'"


def _balances(db) -> tuple:
    rows = db.execute(text("""
        select a.account_type::text, sum(case when l.direction='debit' then l.amount else -l.amount end)
        from ledger_line l join account a on a.id = l.account_id
        where a.branch_id = 3 and a.account_type::text in ('customer_receivable','supplier_payable','treasury')
        group by 1 order by 1""")).all()
    return tuple((t, round(float(v or 0), 2)) for t, v in rows)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true")
    args = ap.parse_args()
    db = SessionLocal()
    try:
        n = db.execute(text(f"select count(*) from ({OLD}) x")).scalar()
        print("قيود قديمة مكرّرة:", n)
        print("قبل:", _balances(db))
        for t, col in (("sales_invoice", "ledger_entry_id"), ("sales_return", "ledger_entry_id"),
                       ("sales_return", "reversal_entry_id"), ("purchase_invoice", "ledger_entry_id"),
                       ("purchase_return", "ledger_entry_id"), ("purchase_return", "reversal_entry_id")):
            r = db.execute(text(f"update {t} set {col} = null where {col} in ({OLD})"))
            print(f"  فك ربط {t}.{col}: {r.rowcount}")
        r = db.execute(text(f"""delete from partial_reconcile where debit_line_id in
            (select id from ledger_line where entry_id in ({OLD})) or credit_line_id in
            (select id from ledger_line where entry_id in ({OLD}))"""))
        print("  تسويات اتشالت:", r.rowcount)
        r = db.execute(text(f"delete from ledger_line where entry_id in ({OLD})"))
        print("  سطور اتشالت:", r.rowcount)
        r = db.execute(text(f"delete from ledger_entry where id in ({OLD})"))
        print("  قيود اتشالت:", r.rowcount)
        print("بعد:", _balances(db))
        if args.yes:
            db.commit()
            print("اتنفّذ — شغّل import_a5_ledger عشان يربط المستندات بقيودها الجديدة.")
        else:
            db.rollback()
            print("عرض بس — `--yes` للتنفيذ.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
