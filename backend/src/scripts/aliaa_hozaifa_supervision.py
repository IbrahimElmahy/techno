from __future__ import annotations

import sys

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.employee import Employee
from src.models.hr_payroll_run import PayrollLine
from src.services import salary_service

BRANCH = 2
EMPLOYEE = 107
RULES = [
    {"basis": "pool", "pct": "2.5", "white_pct": "2", "split": 2, "pools": [8]},
    {"basis": "pool", "pct": "0.7", "white_pct": "0.7", "split": 1, "pools": [8, 10]},
]


def run(*, execute: bool, actor: int) -> None:
    db = SessionLocal()
    try:
        emp = db.get(Employee, EMPLOYEE)
        assert emp is not None and emp.name.startswith("حذيفه") and emp.branch_id == BRANCH
        salary_service.save_rules(db, employee=emp, rules=RULES, actor_user_id=actor)
        db.flush()
        for month in (10, 11):
            pr = salary_service.calculate(db, branch_id=BRANCH, year=2026, month=month,
                                          actor_user_id=actor)
            db.flush()
            ln = db.scalar(select(PayrollLine).where(PayrollLine.run_id == pr.id,
                                                     PayrollLine.employee_id == emp.id))
            print(f"{month}: عمولة {ln.commission} — صافي {ln.net} — إجمالي الشهر {pr.net}")
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
