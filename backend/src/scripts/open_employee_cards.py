from __future__ import annotations

import argparse

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.employee import Employee
from src.services import audit_service, employee_card_service


def run(*, codes: list[str], execute: bool) -> None:
    db = SessionLocal()
    try:
        for code in codes:
            emp = db.scalar(select(Employee).where(Employee.code == code))
            if emp is None:
                print(f"{code}: مش موجود")
                continue
            card = employee_card_service.open_card(db, emp)
            print(f"{code} {emp.name}: كارت {card.code if card else '—'} حساب {emp.receivable_account_id}")
            if card is not None:
                audit_service.record(db, action="employee.open_card", actor_user_id=None,
                                     entity_type="employee", entity_id=emp.id,
                                     after={"customer_id": card.id,
                                            "account_id": emp.receivable_account_id})
        if not execute:
            db.rollback()
            print("عرض فقط — أضف --yes للتنفيذ")
            return
        db.commit()
        print("تم")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="فتح كارت وحساب ذمة لموظفين مضافين من الشاشة")
    ap.add_argument("--codes", required=True, help="أكواد الموظفين مفصولة بفاصلة")
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args()
    run(codes=[c.strip() for c in a.codes.split(",") if c.strip()], execute=a.yes)


if __name__ == "__main__":
    main()
