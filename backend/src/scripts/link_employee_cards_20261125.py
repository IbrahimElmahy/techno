from __future__ import annotations

import sys

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.customer import Customer, CustomerAccount
from src.models.employee import Employee
from src.models.org import Territory
from src.services import audit_service, employee_card_service


def card_for_account(db, emp: Employee) -> Customer | None:
    territory = db.scalar(select(Territory.id).where(Territory.branch_id == emp.branch_id)
                          .order_by(Territory.id))
    if territory is None:
        return None
    code = emp.code
    if db.scalar(select(Customer.id).where(Customer.code == code)) is not None:
        code = f"{emp.code}-{emp.id}"
    card = Customer(code=code[:24], name=emp.name, customer_type="employee",
                    employee_id=emp.id, territory_id=territory, branch_id=emp.branch_id,
                    phone=emp.phone, active=True)
    db.add(card)
    db.flush()
    db.add(CustomerAccount(customer_id=card.id, account_id=emp.receivable_account_id))
    db.flush()
    return card


def main() -> None:
    execute = "--yes" in sys.argv[1:]
    ids = [int(x) for x in sys.argv[sys.argv.index("--ids") + 1].split(",")]
    db = SessionLocal()
    try:
        for emp_id in ids:
            emp = db.get(Employee, emp_id)
            if emp is None or db.scalar(select(Customer.id).where(Customer.employee_id == emp_id)):
                print(emp_id, "skip")
                continue
            card = (card_for_account(db, emp) if emp.receivable_account_id
                    else employee_card_service.open_card(db, emp))
            print(emp_id, emp.code, emp.name, "->", card.code if card else None,
                  "account", emp.receivable_account_id)
            if card is not None:
                audit_service.record(db, action="employee.open_card", actor_user_id=None,
                                     entity_type="employee", entity_id=emp.id,
                                     after={"customer_id": card.id,
                                            "account_id": emp.receivable_account_id})
        if execute:
            db.commit()
            print("APPLIED")
        else:
            db.rollback()
            print("DRY RUN")
    finally:
        db.close()


if __name__ == "__main__":
    main()
