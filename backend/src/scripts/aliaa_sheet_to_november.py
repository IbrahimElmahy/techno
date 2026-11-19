from __future__ import annotations

import sys
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.employee import Employee
from src.models.hr_advance import AdjustmentStatus, PayrollAdjustment
from src.models.hr_payroll_run import PayrollLine
from src.services import salary_service as svc

BRANCH = 2


def run(*, execute: bool, actor: int) -> None:
    db = SessionLocal()
    try:
        oct_run = svc.current_run(db, branch_id=BRANCH, year=2026, month=10)
        nov_run = svc.current_run(db, branch_id=BRANCH, year=2026, month=11)
        assert oct_run is not None and nov_run is not None
        oct_lines = db.scalars(select(PayrollLine).where(PayrollLine.run_id == oct_run.id)).all()
        manual = {ln.employee_id: svc._manual_of(ln) for ln in oct_lines}
        want = {ln.employee_id: Decimal(str(ln.net)) for ln in oct_lines}
        svc.delete_draft(db, run_id=oct_run.id, actor_user_id=actor)
        adjs = db.scalars(select(PayrollAdjustment).join(
            Employee, Employee.id == PayrollAdjustment.employee_id).where(
            Employee.branch_id == BRANCH, PayrollAdjustment.year == 2026,
            PayrollAdjustment.month == 10,
            PayrollAdjustment.status != AdjustmentStatus.cancelled)).all()
        for a in adjs:
            a.month = 11
        db.flush()
        print(f"حركات اتنقلت لنوفمبر: {len(adjs)}")
        for ln in db.scalars(select(PayrollLine).where(PayrollLine.run_id == nov_run.id)).all():
            fields = manual.get(ln.employee_id) or {k: None for k in svc._MANUAL}
            svc.update_line(db, run_id=nov_run.id, employee_id=ln.employee_id,
                            fields=dict(fields), actor_user_id=actor)
        pr = svc.calculate(db, branch_id=BRANCH, year=2026, month=11, actor_user_id=actor)
        db.flush()
        got = {ln.employee_id: Decimal(str(ln.net)) for ln in db.scalars(
            select(PayrollLine).where(PayrollLine.run_id == pr.id)).all()}
        bad = [(db.get(Employee, k).name, want.get(k), got.get(k))
               for k in set(want) | set(got) if want.get(k) != got.get(k)]
        print(f"نوفمبر {pr.document_number}: {len(got)} موظف — صافي {sum(got.values())} "
              f"(أكتوبر كان {sum(want.values())})")
        for b in bad:
            print("فرق:", b)
        if bad:
            raise SystemExit("فيه فروق — لم يُحفظ شيء.")
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
