from __future__ import annotations

import sys

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.customer import Customer, CustomerAccount
from src.models.employee import Employee
from src.models.ledger import Account, AccountNature
from src.services import audit_service, customer_merge_service

OWNERS: dict[str, str] = {}


def run(*, execute: bool, actor: int) -> None:
    db = SessionLocal()
    try:
        cards: dict[tuple, list[tuple[Customer, int]]] = {}
        for c, account_id in db.execute(
                select(Customer, CustomerAccount.account_id)
                .join(CustomerAccount, CustomerAccount.customer_id == Customer.id)
                .where(Customer.customer_type == "employee", Customer.active.is_(True),
                       Customer.code.notin_(list(OWNERS)))).all():
            cards.setdefault((c.branch_id, customer_merge_service.match_key(c.name)), []).append(
                (c, account_id))

        set_acc = tagged = conflicts = 0
        for e in db.scalars(select(Employee).order_by(Employee.id)):
            hits = cards.get((e.branch_id, customer_merge_service.match_key(e.name))) or []
            if e.receivable_account_id:
                same = [h for h in hits if h[1] == e.receivable_account_id]
                if same:
                    for c, _ in same:
                        if c.employee_id is None:
                            c.employee_id = e.id
                            tagged += 1
                elif hits:
                    conflicts += 1
                    print(f"تعارض: {e.code} {e.name} حسابه {e.receivable_account_id} "
                          f"والكارت {[h[0].code for h in hits]} على حساب تاني")
                continue
            if len(hits) != 1:
                if len(hits) > 1:
                    conflicts += 1
                    print(f"أكتر من كارت: {e.code} {e.name} {[h[0].code for h in hits]}")
                continue
            c, account_id = hits[0]
            e.receivable_account_id = account_id
            if c.employee_id is None:
                c.employee_id = e.id
                tagged += 1
            set_acc += 1
            print(f"ربط: {e.code} {e.name} ⇐ {c.code}")

        for code, parent_code in OWNERS.items():
            c = db.scalar(select(Customer).where(Customer.code == code))
            parent = db.scalar(select(Account).where(Account.code == parent_code))
            if c is None or parent is None:
                print(f"مش لاقي {code} أو {parent_code}")
                continue
            c.customer_type = "owner"
            for ca in db.scalars(select(CustomerAccount).where(CustomerAccount.customer_id == c.id)):
                acc = db.get(Account, ca.account_id)
                acc.parent_id = parent.id
                acc.nature = AccountNature.equity
                print(f"شريك: {c.code} {c.name} ← حسابه {acc.code} تحت «{parent.name}»")

        db.flush()
        audit_service.record(db, action="employee.link_dues", actor_user_id=actor,
                             entity_type="employee", entity_id=None,
                             after={"linked": set_acc, "tagged": tagged, "owners": list(OWNERS)})
        print(f"موظفين اتربطوا بحسابهم: {set_acc} · كروت اتعلّمت بموظفها: {tagged} · تعارض: {conflicts}")
        if execute:
            db.commit()
            print("اتحفظ.")
        else:
            db.rollback()
            print("تجربة فقط — أضف --yes للحفظ.")
    finally:
        db.close()


if __name__ == "__main__":
    actor_arg = next((a for a in sys.argv if a.startswith("--actor=")), "--actor=1")
    run(execute="--yes" in sys.argv, actor=int(actor_arg.split("=")[1]))
