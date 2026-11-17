from __future__ import annotations

import sys
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.core.money import ZERO, to_money
from src.models.employee import Employee
from src.models.hr_advance import AdvanceStatus, EmployeeAdvance, EmployeeAdvanceInstalment
from src.models.hr_payroll_run import (
    DetailKind, DetailSource, PayrollLine, PayrollLineDetail, PayrollRun, PayrollRunStatus,
)
from src.services import audit_service, salary_service

BRANCH, YEAR, MONTH = 3, 2026, 10


def run(*, execute: bool, actor: int) -> None:
    db = SessionLocal()
    try:
        pr = salary_service.current_run(db, branch_id=BRANCH, year=YEAR, month=MONTH)
        if pr is None or pr.status != PayrollRunStatus.draft:
            raise SystemExit("مرتبات أكتوبر للسادات مش مسودة.")
        legacy = db.scalars(select(EmployeeAdvance).where(
            EmployeeAdvance.status == AdvanceStatus.active,
            EmployeeAdvance.ledger_entry_id.is_(None), EmployeeAdvance.voucher_id.is_(None))).all()
        legacy_emps = {a.employee_id for a in legacy}
        moved = ZERO
        for line in db.scalars(select(PayrollLine).where(PayrollLine.run_id == pr.id)).all():
            amount = to_money(Decimal(str(line.advance_deduction or 0)))
            if not amount or line.employee_id not in legacy_emps:
                continue
            emp = db.get(Employee, line.employee_id)
            if emp.receivable_account_id is None:
                raise SystemExit(f"«{emp.name}» ليس له حساب ذمة — لم يُحفظ شيء.")
            for d in db.scalars(select(PayrollLineDetail).where(
                    PayrollLineDetail.line_id == line.id,
                    PayrollLineDetail.source == DetailSource.advance)).all():
                db.delete(d)
            db.add(PayrollLineDetail(line_id=line.id, source=DetailSource.manual,
                                     label="خصم من المستحقات", kind=DetailKind.deduction,
                                     amount=amount))
            line.dues_deduction = to_money(Decimal(str(line.dues_deduction or 0)) + amount)
            line.advance_deduction = ZERO
            moved += amount
            print(f"{emp.name}: {amount} من السلف إلى خصم من الذمة — الصافي {line.net}")
        for a in legacy:
            for p in db.scalars(select(EmployeeAdvanceInstalment).where(
                    EmployeeAdvanceInstalment.advance_id == a.id)).all():
                db.delete(p)
            a.status = AdvanceStatus.cancelled
        db.flush()
        salary_service._refresh_totals(db, pr)
        audit_service.record(db, action="advance.legacy_to_dues", actor_user_id=actor,
                             entity_type="payroll_run", entity_id=pr.id,
                             after={"moved": str(moved), "cancelled": [a.document_number for a in legacy]})
        print(f"اتنقل {moved} · سلف اتلغت: {len(legacy)} · صافي الشهر {pr.net if hasattr(pr, 'net') else ''}")
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
