from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.customer import Customer, CustomerAccount
from src.models.employee import Employee
from src.models.ledger import Account, AccountType, Direction
from src.models.org import Territory

GROUP_NAME = "ذمم الموظفين"


def open_card(db: Session, emp: Employee) -> Customer | None:
    card = db.scalar(select(Customer).where(Customer.employee_id == emp.id))
    if card is not None or emp.receivable_account_id:
        return card
    territory = db.scalar(select(Territory.id).where(Territory.branch_id == emp.branch_id)
                          .order_by(Territory.id))
    group = db.scalar(select(Account).where(Account.branch_id == emp.branch_id,
                                            Account.name == GROUP_NAME,
                                            Account.is_postable.is_(False)))
    if territory is None or group is None:
        return None
    code = emp.code
    if db.scalar(select(Account.id).where(Account.code == code)) is not None:
        code = f"{emp.code}-{emp.id}"
    account = Account(account_type=AccountType.user_defined, code=code[:40], name=emp.name[:160],
                      nature=group.nature, normal_side=Direction.debit, is_postable=True,
                      parent_id=group.id, branch_id=emp.branch_id)
    db.add(account)
    db.flush()
    card_code = emp.code
    if db.scalar(select(Customer.id).where(Customer.code == card_code)) is not None:
        card_code = f"{emp.code}-{emp.id}"
    card = Customer(code=card_code[:24], name=emp.name, customer_type="employee",
                    employee_id=emp.id, territory_id=territory, branch_id=emp.branch_id,
                    phone=emp.phone, active=True)
    db.add(card)
    db.flush()
    db.add(CustomerAccount(customer_id=card.id, account_id=account.id))
    emp.receivable_account_id = account.id
    db.flush()
    return card
