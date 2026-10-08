from __future__ import annotations

import argparse
from collections import Counter

from sqlalchemy import select, text

from src.core.db import SessionLocal
from src.models.ledger import Account, AccountType
from src.services import account_routing_service

BRANCHES = {1: "أكتوبر", 2: "العلياء", 3: "السادات"}
PREFIX = {1: "A5", 2: "AL-A5", 3: "FC-A5"}
SALES_NAME = "مبيعات المركز الرئيسى"
PURCH_NAME = "مشتريات المركز الرئيسى"
ROUND_NAME = "فروق تقريب"
DOC_TABLES = ("sales_invoice", "sales_return", "purchase_invoice", "purchase_return")


def _leaf(db, branch_id: int, name: str) -> Account | None:
    rows = db.scalars(select(Account).where(
        Account.branch_id == branch_id, Account.name == name,
        Account.is_postable.is_(True), Account.active.is_(True)).order_by(Account.id)).all()
    pref = PREFIX[branch_id] + "S-"
    coded = [a for a in rows if (a.code or "").startswith(pref)]
    return (coded or rows or [None])[0]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true")
    args = ap.parse_args()
    db = SessionLocal()
    q = lambda sql_, **p: db.execute(text(sql_), p).all()  # noqa: E731
    try:
        unbalanced_sql = """select count(*) from (select entry_id from ledger_line group by entry_id
            having sum(case when direction='debit' then amount else -amount end) <> 0) x"""
        unbalanced_before = q(unbalanced_sql)[0][0]

        sales, purch = {}, {}
        for b, bname in BRANCHES.items():
            sa, pu = _leaf(db, b, SALES_NAME), _leaf(db, b, PURCH_NAME)
            if sa is None or pu is None:
                raise SystemExit(f"[{bname}] مش لاقي «{SALES_NAME}» أو «{PURCH_NAME}» — وقفت.")
            sales[b], purch[b] = sa.id, pu.id
            for role, acc in (("sales_revenue", sa), ("purchases_expense", pu)):
                cur = account_routing_service.routed_account(db, role, branch_id=b)
                if cur is None or cur.id != acc.id:
                    print(f"[{bname}] توجيه {role}: {cur.code if cur else 'افتراضي'} ⇒ {acc.code} «{acc.name}»")
                    account_routing_service.set_routing(db, role, account_id=acc.id, branch_id=b)
        old_sales = [a.id for a in db.scalars(select(Account).where(
            Account.account_type == AccountType.sales_revenue, Account.code.is_(None))).all()]
        old_purch = [a.id for a in db.scalars(select(Account).where(
            Account.account_type == AccountType.purchases_expense, Account.code.is_(None))).all()]
        print("حسابات النظام القديمة: مبيعات", old_sales, "مشتريات", old_purch)

        for t in DOC_TABLES:
            r = db.execute(text(f"""
                update ledger_entry e set branch_id = d.branch_id
                from {t} d where d.ledger_entry_id = e.id
                  and e.branch_id is null and d.branch_id is not null"""))
            print(f"قيود من غير فرع خدت فرع {t}: {r.rowcount}")
        left = q("select count(*) from ledger_entry where branch_id is null")[0][0]
        print(f"  فاضل من غير فرع: {left}")

        moved = Counter()
        for olds, target, label in ((old_sales, sales, "مبيعات"), (old_purch, purch, "مشتريات")):
            if not olds:
                continue
            for b in BRANCHES:
                r = db.execute(text("""
                    update ledger_line l set account_id = :to
                    from ledger_entry e
                    where e.id = l.entry_id and e.branch_id = :b and l.account_id = any(:olds)"""),
                    {"to": target[b], "b": b, "olds": olds})
                moved[(label, BRANCHES[b])] += r.rowcount
        for k, v in sorted(moved.items()):
            print(f"سطور {k[0]} اتنقلت لحساب {k[1]}: {v}")
        still = q("select count(*) from ledger_line where account_id = any(:o)",
                  o=old_sales + old_purch)[0][0]
        print(f"  سطور فاضلة على حسابات النظام القديمة (قيود من غير فرع): {still}")

        for b in BRANCHES:
            need = q("""select count(*) from ledger_line l join ledger_entry e on e.id=l.entry_id
                join account a on a.id=l.account_id where e.branch_id=:b and a.name=:nm
                and a.branch_id is not null and a.branch_id <> :b""", b=b, nm=ROUND_NAME)[0][0]
            if not need:
                continue
            acc = _leaf(db, b, ROUND_NAME)
            if acc is None:
                tmpl = db.scalar(select(Account).where(Account.name == ROUND_NAME)
                                 .order_by(Account.id))
                acc = Account(account_type=tmpl.account_type, owner_ref=None,
                              normal_side=tmpl.normal_side, name=ROUND_NAME, nature=tmpl.nature,
                              is_postable=True, is_system=False, branch_id=b)
                db.add(acc)
                db.flush()
                print(f"[{BRANCHES[b]}] حساب «{ROUND_NAME}» جديد #{acc.id}")
            r = db.execute(text("""
                update ledger_line l set account_id = :to
                from ledger_entry e, account a
                where e.id = l.entry_id and a.id = l.account_id and e.branch_id = :b
                  and a.name = :nm and a.branch_id is not null and a.branch_id <> :b"""),
                {"to": acc.id, "b": b, "nm": ROUND_NAME})
            if r.rowcount:
                print(f"فروق تقريب ⇒ «{acc.name}» {BRANCHES[b]} ({acc.code}): {r.rowcount}")

        r = db.execute(text("""
            update customer c set branch_id = u.branch_id from "user" u
            where u.id = c.rep_id and c.branch_id is null and u.branch_id is not null"""))
        print(f"عملاء خدوا فرع مندوبهم: {r.rowcount}")

        for src_id, src_b in q("select id, branch_id from supplier where name = 'ايجارات'"):
            src_acc = q("select account_id from supplier_account where supplier_id=:s", s=src_id)[0][0]
            for b in BRANCHES:
                if b == src_b:
                    continue
                dst = q("select id from supplier where name = :n", n=f"ايجارات — {BRANCHES[b]}")
                if not dst:
                    continue
                dst_id = dst[0][0]
                dst_acc = q("select account_id from supplier_account where supplier_id=:s", s=dst_id)[0][0]
                for doc_id, entry_id, num in q(
                        "select id, ledger_entry_id, document_number from purchase_invoice "
                        "where supplier_id=:s and branch_id=:b", s=src_id, b=b):
                    db.execute(text("update purchase_invoice set supplier_id=:d where id=:i"),
                               {"d": dst_id, "i": doc_id})
                    if entry_id:
                        db.execute(text("update ledger_line set account_id=:da where entry_id=:e "
                                        "and account_id=:sa"), {"da": dst_acc, "e": entry_id, "sa": src_acc})
                        db.execute(text("update ledger_entry set partner_id=:d where id=:e "
                                        "and partner_id=:s"), {"d": dst_id, "e": entry_id, "s": src_id})
                    print(f"شرا {num} ({BRANCHES[b]}): «ايجارات» أكتوبر ⇒ «ايجارات — {BRANCHES[b]}»")

        unbalanced = q(unbalanced_sql)[0][0] - unbalanced_before
        mixed = q("""select e.entry_type, count(distinct e.id) from ledger_entry e
            join ledger_line l on l.entry_id=e.id join account a on a.id=l.account_id
            where e.branch_id is not null and a.branch_id is not null and a.branch_id <> e.branch_id
            group by 1""")
        print(f"تحقق: قيود اتخلّت مش متوازنة {unbalanced} (قديم قبل السكربت: {unbalanced_before})"
              f" · قيود فرع على حسابات فرع تاني {mixed}")
        if unbalanced:
            raise SystemExit("فيه قيود مش متوازنة — مافيش حاجة اتكتبت.")

        if args.yes:
            db.commit()
            print("اتنفّذ.")
        else:
            db.rollback()
            print("عرض بس — `--yes` للتنفيذ.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
