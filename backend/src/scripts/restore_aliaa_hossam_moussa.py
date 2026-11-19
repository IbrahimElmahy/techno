from __future__ import annotations

import sys
from datetime import date
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.employee import Employee
from src.models.hr_payroll_run import PayrollLine
from src.models.hr_salary import CommissionPool
from src.services import salary_service

BRANCH = 2
EMPLOYEE = 89


def run(*, execute: bool, actor: int) -> None:
    db = SessionLocal()
    try:
        emp = db.get(Employee, EMPLOYEE)
        assert emp is not None and emp.name.strip() == "حسام موسي" and emp.branch_id == BRANCH
        emp.active = True
        pool = db.scalar(select(CommissionPool).where(
            CommissionPool.branch_id == BRANCH, CommissionPool.name == "الشرقية",
            CommissionPool.active.is_(True)))
        salary_service.save_card(
            db, employee=emp, effective_from=date(2026, 10, 1), basic=1818,
            items=[{"name": "منحة غلاء", "amount": 500}], insurance=0, rules=[],
            actor_user_id=actor)
        salary_service.save_rules(db, employee=emp, actor_user_id=actor, rules=[
            {"basis": "pool", "pct": "2.5", "white_pct": "2", "split": 2, "pools": [pool.id]}])
        db.flush()
        for month in (10, 11):
            pr = salary_service.calculate(db, branch_id=BRANCH, year=2026, month=month,
                                          actor_user_id=actor)
            if month == 10:
                salary_service.update_line(db, run_id=pr.id, employee_id=emp.id,
                                           fields={"notes": "نصف عمولة سيارة الشرقية"},
                                           actor_user_id=actor)
            db.flush()
            lines = db.scalars(select(PayrollLine).where(PayrollLine.run_id == pr.id)).all()
            mine = next((ln for ln in lines if ln.employee_id == emp.id), None)
            total = sum((Decimal(str(ln.net)) for ln in lines), Decimal(0))
            print(f"{pr.document_number} {month}: موظفين {len(lines)} — صافي حسام "
                  f"{mine.net if mine else None} — الإجمالي {total}")
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
