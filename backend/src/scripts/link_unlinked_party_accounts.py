"""يربط حسابات العملاء/الموظفين/الموردين اللي عليها رصيد ومالهاش كارت — أكتوبر والعلياء (٢٠٢٦-١٠-٠٦).

    python -m src.scripts.link_unlinked_party_accounts          # يعرض بس
    python -m src.scripts.link_unlinked_party_accounts --yes    # ينفّذ

مراجعة «كل حساب تحت العملاء/ذمم الموظفين/الموردون عليه رصيد لازم يبقى على كارت» طلّعت
٩ حسابات من غير كارت — رصيدهم مطابق a5 بس مش ظاهرين في أي شاشة (مديونيات، موظفين، موردين):

* كارت موجود ومالوش الحساب ده: «شركه المدينه» (عميل، ٩٣٬٥٣٣ — كارته عليه حساب فاضي من
  غير ولا سطر)، «ايجارات — العلياء» و«تكنو بايت» (موردين).
* حساب تحت «ذمم الموظفين» مالوش كارت ⇒ كارت موظف بنفس الاسم وكود `A5E-<رقم a5>` زي
  `link_sadat_parties`: عمرو رجب، عهدة سيارة الفيوم/اكتوبر (أكتوبر)، احمد صبرى، ابراهيم
  حسونه، كامل هلول (العلياء).

الحساب الفاضي اللي بيتشال من الكارت بيتشال **بس لو مالوش ولا سطر** — وإلا بيقف.
"""
from __future__ import annotations

import sys

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.customer import Customer, CustomerAccount
from src.models.ledger import Account, LedgerLine
from src.models.role import Role, RoleName
from src.models.supplier import SupplierAccount
from src.models.user import User
from src.models.org import Territory

# (كارت العميل، حساب a5) — الكارت عليه حساب فاضي بيتبدّل
CUSTOMER_RELINK = [(3756, "AL-A5S-4356")]
# (المورد، حساب a5) — حساب المورد الفاضي (لو فيه) بيتبدّل
SUPPLIER_RELINK = [(155, "AL-A5S-1944"), (37, "AL-A5S-4354")]
# حسابات موظفين مالهاش كارت
NEW_EMPLOYEES = ["A5S-55", "A5S-1215", "A5S-1213", "AL-A5S-198", "AL-A5S-400", "AL-A5S-9"]
NOTE = "كارت موظف لحساب a5 تحت «ذمم الموظفين» كان من غير كارت."


def _lines(db, account_id: int) -> int:
    return db.scalar(select(func.count()).select_from(LedgerLine)
                     .where(LedgerLine.account_id == account_id)) or 0


def run(*, execute: bool) -> int:
    db = SessionLocal()
    try:
        acc = {a.code: a for a in db.scalars(select(Account).where(Account.code.in_(
            [c for _i, c in CUSTOMER_RELINK + SUPPLIER_RELINK] + NEW_EMPLOYEES))).all()}
        linked = {r for (r,) in db.execute(select(CustomerAccount.account_id))} | \
            {r for (r,) in db.execute(select(SupplierAccount.account_id))}

        for cid, code in CUSTOMER_RELINK:
            a = acc[code]
            if a.id in linked:
                print(f"  {code} مربوط خلاص")
                continue
            old = db.scalars(select(CustomerAccount).where(CustomerAccount.customer_id == cid)).all()
            if any(_lines(db, o.account_id) for o in old):
                print(f"  ⚠ الكارت #{cid} عليه حساب فيه حركة — اتخطّى")
                continue
            for o in old:
                db.delete(o)
            db.flush()
            db.add(CustomerAccount(customer_id=cid, account_id=a.id))
            print(f"  عميل #{cid} ⇐ {code} «{a.name}»")

        for sid, code in SUPPLIER_RELINK:
            a = acc[code]
            if a.id in linked:
                print(f"  {code} مربوط خلاص")
                continue
            old = db.scalars(select(SupplierAccount).where(SupplierAccount.supplier_id == sid)).all()
            if any(_lines(db, o.account_id) for o in old):
                print(f"  ⚠ المورد #{sid} عليه حساب فيه حركة — اتخطّى")
                continue
            for o in old:
                db.delete(o)
            db.flush()
            db.add(SupplierAccount(supplier_id=sid, account_id=a.id))
            print(f"  مورد #{sid} ⇐ {code} «{a.name}»")

        rep_role = db.scalar(select(Role.id).where(Role.name == RoleName.sales_rep))
        codes = {c for (c,) in db.execute(select(Customer.code))}
        for code in NEW_EMPLOYEES:
            a = acc[code]
            if a.id in linked:
                print(f"  {code} مربوط خلاص")
                continue
            prefix = "AL-" if code.startswith("AL-") else ""
            ccode = f"{prefix}A5E-{code.rsplit('-', 1)[-1]}"
            if ccode in codes:
                print(f"  ⚠ الكود {ccode} موجود — اتخطّى")
                continue
            rep = db.scalar(select(User.id).where(User.role_id == rep_role, User.branch_id == a.branch_id)
                            .order_by(User.id))
            terr = db.scalar(select(Territory.id).where(Territory.branch_id == a.branch_id)
                             .order_by(Territory.id))
            c = Customer(code=ccode, name=(a.name or "").strip(), customer_type="employee",
                         rep_id=rep, territory_id=terr, branch_id=a.branch_id, address=NOTE,
                         active=True)
            db.add(c)
            db.flush()
            db.add(CustomerAccount(customer_id=c.id, account_id=a.id))
            print(f"  موظف جديد {ccode} «{c.name}» ⇐ {code}")

        if not execute:
            db.rollback()
            print("\nعرض فقط — `--yes` للتنفيذ.")
            return 0
        db.commit()
        print("\n✔ اتحفظ.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(run(execute="--yes" in sys.argv[1:]))
