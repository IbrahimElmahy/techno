from __future__ import annotations

import sys
from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.employee import Employee
from src.models.hr_advance import AdjustmentKind, AdjustmentStatus, PayrollAdjustment
from src.models.hr_payroll import ComponentKind, EmployeeSalary, EmployeeSalaryLine
from src.models.hr_payroll_run import PayrollLine, PayrollRun, PayrollRunStatus
from src.services import payroll_setup_service as setup
from src.services import salary_service

BRANCH = 2
NAME = "إضافي"
FROM = date(2026, 10, 1)


def nets(db, month: int) -> dict[int, Decimal]:
    run = db.scalar(select(PayrollRun).where(
        PayrollRun.branch_id == BRANCH, PayrollRun.year == 2026, PayrollRun.month == month,
        PayrollRun.status == PayrollRunStatus.draft))
    return {ln.employee_id: Decimal(str(ln.net)) for ln in db.scalars(
        select(PayrollLine).where(PayrollLine.run_id == run.id)).all()}


def run(*, execute: bool, actor: int) -> None:
    db = SessionLocal()
    try:
        before = nets(db, 10)
        adjs = db.scalars(select(PayrollAdjustment).join(
            Employee, Employee.id == PayrollAdjustment.employee_id).where(
            Employee.branch_id == BRANCH, PayrollAdjustment.year == 2026,
            PayrollAdjustment.month == 10, PayrollAdjustment.kind == AdjustmentKind.other_earning,
            PayrollAdjustment.reason == NAME,
            PayrollAdjustment.status != AdjustmentStatus.cancelled)).all()
        total: dict[int, Decimal] = defaultdict(Decimal)
        for a in adjs:
            total[a.employee_id] += Decimal(str(a.amount))
        comp = salary_service._component_for(db, NAME, ComponentKind.earning, actor)
        for emp_id, amount in total.items():
            emp = db.get(Employee, emp_id)
            versions = db.scalars(select(EmployeeSalary).where(
                EmployeeSalary.employee_id == emp_id, EmployeeSalary.effective_from >= FROM)).all()
            if not versions:
                raise SystemExit(f"لا يوجد كارت مرتب لـ{emp.name}")
            for v in versions:
                lines = [{"component_id": ln.component_id, "amount": ln.amount, "pct": ln.pct,
                          "notes": ln.notes}
                         for ln in db.scalars(select(EmployeeSalaryLine).where(
                             EmployeeSalaryLine.salary_id == v.id)).all()
                         if ln.component_id != comp.id]
                lines.append({"component_id": comp.id, "amount": amount})
                setup.set_salary(db, employee_id=emp_id, effective_from=v.effective_from,
                                 basic=v.basic, lines=lines, notes=v.notes, actor_user_id=actor)
            print(f"{emp.name}: {NAME} ثابت {amount}")
        for a in adjs:
            salary_service.delete_adjustment(db, adjustment_id=a.id, actor_user_id=actor)
        db.flush()
        for month in (10, 11):
            salary_service.calculate(db, branch_id=BRANCH, year=2026, month=month,
                                     actor_user_id=actor)
        db.flush()
        after = nets(db, 10)
        bad = [(db.get(Employee, k).name, before[k], after.get(k)) for k in before
               if after.get(k) != before[k]]
        nov = nets(db, 11)
        print(f"أكتوبر: {sum(before.values())} → {sum(after.values())}  فروق: {bad}")
        print(f"نوفمبر: {sum(nov.values())}")
        if bad:
            raise SystemExit("صافي أكتوبر اتغير — لم يُحفظ شيء.")
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
