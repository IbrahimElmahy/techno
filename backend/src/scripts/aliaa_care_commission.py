from __future__ import annotations

import sys

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.employee import Employee
from src.models.hr_payroll_run import PayrollLine
from src.services import salary_service as svc

BRANCH = 2
RULES = {
    40: (48, 10, False),
    38: (48, 10, False),
    63: (48, 10, False),
    73: (48, 10, False),
    93: (48, 10, False),
    83: (48, 10, False),
    31: (30, 0, True),
}


def run(*, execute: bool, actor: int) -> None:
    db = SessionLocal()
    try:
        for emp_id, (irate, prate, all_techs) in RULES.items():
            emp = db.get(Employee, emp_id)
            assert emp is not None and emp.branch_id == BRANCH and emp.user_id
            keep = [svc._rule_out(r) for r in svc.rules_of(db, emp.id)
                    if r.basis.value != "care"]
            svc.save_rules(db, employee=emp, actor_user_id=actor, rules=[*keep, {
                "basis": "care", "inspection_rate": irate, "plumber_rate": prate,
                "all_techs": all_techs}])
        db.flush()
        pr = svc.calculate(db, branch_id=BRANCH, year=2026, month=11, actor_user_id=actor)
        db.flush()
        for emp_id in RULES:
            emp = db.get(Employee, emp_id)
            ln = db.scalar(select(PayrollLine).where(PayrollLine.run_id == pr.id,
                                                     PayrollLine.employee_id == emp_id))
            label = " + ".join(p["label"] for p in svc.commission_preview(db, emp, 2026, 11))
            print(f"{emp.name}: {label} = {ln.commission} — صافي {ln.net}")
        print(f"إجمالي نوفمبر: {pr.net}")
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
