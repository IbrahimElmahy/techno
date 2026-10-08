from __future__ import annotations

import re
import sys
from collections import Counter, defaultdict

from sqlalchemy import select, text

from src.core.db import SessionLocal
from src.models.customer import Customer, CustomerAccount
from src.models.ledger import Account
from src.models.org import Branch
from src.models.supplier import Supplier, SupplierAccount

BRANCH = "السادات"
CUSTOMER_GROUPS = ("العملاء", "ذمم الموظفين")
SUPPLIER_GROUPS = ("الموردون", "الموردين")
EMP_GROUP = "ذمم الموظفين"
NOTE = "كارت موظف منقول من a5 (السادات)"

NOT_A_PERSON = re.compile(
    r"^\s*(مندوب\s*(ال)?سيار[هة]|ادار[هة]|إدار[هة]|بونص|صندوق|خزين[هة]|خزن[هة]|"
    r"عهد[هة]|مخزن|فرع)")
HAS_ARABIC = re.compile(r"[ء-ي]{2,}")


def _norm(s: str) -> str:
    s = re.sub(r"[أإآٱ]", "ا", s or "")
    s = s.replace("ة", "ه").replace("ى", "ي").replace("ـ", "")
    return re.sub(r"\s+", " ", s).strip()


def _balances(db, bid: int) -> dict[int, float]:
    return {a: float(b) for a, b in db.execute(text("""
        select l.account_id, sum(case when l.direction='debit' then l.amount else -l.amount end)
        from ledger_line l join account a on a.id = l.account_id where a.branch_id = :b
        group by 1"""), {"b": bid}).all()}


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        br = db.scalars(select(Branch).where(Branch.name == BRANCH)).one()
        bid = br.id

        accounts = db.scalars(select(Account).where(Account.branch_id == bid)).all()
        by_id = {a.id: a for a in accounts}
        group_of = {a.id: (by_id[a.parent_id].name or "").strip()
                    for a in accounts if a.parent_id in by_id and a.is_postable}

        def book(groups):
            out: dict[str, list[Account]] = defaultdict(list)
            for a in accounts:
                if group_of.get(a.id) in groups:
                    out[_norm(a.name or "")].append(a)
            return out

        cust_book, supp_book = book(CUSTOMER_GROUPS), book(SUPPLIER_GROUPS)
        customers = db.scalars(select(Customer).where(Customer.branch_id == bid)).all()
        suppliers = db.scalars(select(Supplier).where(Supplier.branch_id == bid)).all()
        cids = {c.id for c in customers}
        sids = {s.id for s in suppliers}

        used = {x.account_id for x in db.scalars(select(CustomerAccount))}
        used |= {x.account_id for x in db.scalars(select(SupplierAccount))}
        linked_c = {x.customer_id for x in db.scalars(select(CustomerAccount))
                    if x.customer_id in cids}
        linked_s = {x.supplier_id for x in db.scalars(select(SupplierAccount))
                    if x.supplier_id in sids}

        plan: list[tuple[str, object, Account]] = []
        report: Counter = Counter()
        unmatched: dict[str, list[str]] = defaultdict(list)

        def resolve(kind, rows, bk, already):
            names = Counter(_norm(r.name) for r in rows)
            for r in rows:
                if r.id in already:
                    report[f"{kind}: متربط قبل كده"] += 1
                    continue
                key = _norm(r.name)
                hits = [a for a in bk.get(key, []) if a.id not in used]
                if not hits:
                    report[f"{kind}: مالوش حساب"] += 1
                    unmatched[kind].append(f"{r.code} · {r.name}")
                    continue
                if len(hits) > 1 or names[key] > 1:
                    report[f"{kind}: ملتبس — اتساب"] += 1
                    unmatched[kind + " (ملتبس)"].append(f"{r.code} · {r.name}")
                    continue
                used.add(hits[0].id)
                plan.append((kind, r, hits[0]))
                report[f"{kind}: هيتربط"] += 1

        resolve("عملاء", customers, cust_book, linked_c)
        resolve("موردين", suppliers, supp_book, linked_s)

        for kind, rows, other in (("عملاء", customers, supp_book), ("موردين", suppliers, cust_book)):
            for nm in list(unmatched[kind]):
                if other.get(_norm(nm.split(" · ", 1)[1])):
                    unmatched[kind].remove(nm)
                    unmatched[kind + " — كارته التاني من النوع التاني واخد الحساب"].append(nm)

        codes = {c for (c,) in db.execute(text("select code from customer"))}
        new_emps: list[Account] = []
        skipped_emp: list[str] = []
        for a in accounts:
            if group_of.get(a.id) != EMP_GROUP or a.id in used:
                continue
            nm = (a.name or "").strip()
            if not HAS_ARABIC.search(nm) or NOT_A_PERSON.match(nm):
                skipped_emp.append(f"{a.code} · {nm}")
                continue
            new_emps.append(a)

        bal = _balances(db, bid)
        print(f"فرع {BRANCH} (#{bid}): {len(customers)} عميل · {len(suppliers)} مورد · "
              f"{len(accounts)} حساب\n")
        for k, v in sorted(report.items()):
            print(f"   {k:<28}{v:>5}")
        print(f"   {'موظفين: كارت جديد':<28}{len(new_emps):>5}")
        moved = sum(abs(bal.get(a.id, 0)) for _k, _r, a in plan) + \
            sum(abs(bal.get(a.id, 0)) for a in new_emps)
        print(f"\nأرصدة هتبان على الكروت (مجموع مطلق): {moved:,.2f}")
        for kind, names in unmatched.items():
            print(f"\n{kind} ({len(names)}):")
            for n in names[:15]:
                print("   ", n)
        if skipped_emp:
            print(f"\nحسابات «ذمم الموظفين» مش أشخاص — من غير كارت ({len(skipped_emp)}):")
            for n in skipped_emp:
                print("   ", n)

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        terr, rep = db.execute(text("""select territory_id, rep_id from customer where branch_id=:b
            group by 1,2 order by count(*) desc limit 1"""), {"b": bid}).one()

        n = 0
        for kind, row, acc in plan:
            assert row.branch_id == bid and acc.branch_id == bid
            if kind == "عملاء":
                db.add(CustomerAccount(customer_id=row.id, account_id=acc.id))
            else:
                db.add(SupplierAccount(supplier_id=row.id, account_id=acc.id))
            n += 1
        made = 0
        for a in new_emps:
            assert a.branch_id == bid
            code = f"FC-A5E-{(a.code or '').rsplit('-', 1)[-1] or a.id}"
            if code in codes:
                continue
            c = Customer(code=code, name=(a.name or "").strip(), customer_type="employee",
                         rep_id=rep, territory_id=terr, branch_id=bid, address=NOTE, active=True)
            db.add(c)
            db.flush()
            db.add(CustomerAccount(customer_id=c.id, account_id=a.id))
            codes.add(code)
            made += 1
        db.commit()
        print(f"\n✔ اتربط {n} كارت بحسابه، واتعمل {made} كارت موظف — في {BRANCH} بس.")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
