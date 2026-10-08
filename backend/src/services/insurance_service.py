from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money
from src.models.employee import Employee
from src.models.hr_payroll import (
    EmployeeInsurance,
    EmployeeSalary,
    EmployeeSalaryLine,
    SalaryComponent,
)
from src.models.hr_payroll_run import PayrollLine, PayrollRun, PayrollRunStatus
from src.services import audit_service

LEGACY_COMPONENT = "تأمينات"

STATUS_LABELS = {
    PayrollRunStatus.draft: "مسودة",
    PayrollRunStatus.closed: "مسودة",
    PayrollRunStatus.posted: "مرحّل",
    PayrollRunStatus.reversed: "ملغى",
}


class InsuranceError(Exception):
    pass


def _month_end(year: int, month: int) -> date:
    nxt = date(year + (month == 12), month % 12 + 1, 1)
    return date.fromordinal(nxt.toordinal() - 1)


def amount_on(db: Session, employee_id: int, day: date) -> EmployeeInsurance | None:
    return db.scalar(
        select(EmployeeInsurance)
        .where(EmployeeInsurance.employee_id == employee_id,
               EmployeeInsurance.effective_from <= day)
        .order_by(EmployeeInsurance.effective_from.desc())
    )


def _insurance_cells(db: Session, employee_id: int) -> list[tuple]:
    return db.execute(
        select(PayrollRun, PayrollLine)
        .join(PayrollLine, PayrollLine.run_id == PayrollRun.id)
        .where(PayrollLine.employee_id == employee_id)
        .order_by(PayrollRun.year.desc(), PayrollRun.month.desc(),
                  PayrollRun.reversal_seq.desc())
    ).all()


def _posted_months(db: Session, employee_id: int) -> list[tuple[int, int]]:
    return [(run.year, run.month) for run, _ in _insurance_cells(db, employee_id)
            if run.status == PayrollRunStatus.posted]


def used_by_posted(db: Session, row: EmployeeInsurance) -> bool:
    for year, month in _posted_months(db, row.employee_id):
        in_force = amount_on(db, row.employee_id, _month_end(year, month))
        if in_force is not None and in_force.id == row.id:
            return True
    return False


def set_amount(
    db: Session, *, employee_id: int, effective_from: date, amount, actor_user_id: int,
    notes: str | None = None,
) -> EmployeeInsurance:
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise InsuranceError("الموظف غير موجود.")
    value = to_money(Decimal(str(amount if amount not in (None, "") else 0)))
    if value < 0:
        raise InsuranceError("لا يمكن أن يكون مبلغ التأمينات سالباً.")
    row = db.scalar(select(EmployeeInsurance).where(
        EmployeeInsurance.employee_id == employee_id,
        EmployeeInsurance.effective_from == effective_from))
    before = str(row.amount) if row is not None else None
    if row is not None and used_by_posted(db, row):
        raise InsuranceError(
            f"مبلغ التأمينات الساري من {effective_from} خُصم في شهر مرحّل — "
            "سجّل المبلغ الجديد بتاريخ سريان جديد.")
    if row is None:
        row = EmployeeInsurance(employee_id=employee_id, effective_from=effective_from)
        db.add(row)
    row.amount = value
    row.notes = (notes or "").strip()[:300] or None
    row.actor_user_id = actor_user_id
    db.flush()
    audit_service.record(
        db, action="employee_insurance.set", actor_user_id=actor_user_id,
        entity_type="employee", entity_id=employee_id,
        before={"from": str(effective_from), "amount": before} if before else None,
        after={"from": str(effective_from), "amount": str(value)},
    )
    return row


def delete_version(db: Session, *, insurance_id: int, actor_user_id: int) -> int:
    row = db.get(EmployeeInsurance, insurance_id)
    if row is None:
        raise InsuranceError("سجل التأمينات غير موجود.")
    if used_by_posted(db, row):
        raise InsuranceError("خُصم هذا المبلغ في شهر مرحّل — لا يمكن حذفه.")
    employee_id = row.employee_id
    before = {"from": str(row.effective_from), "amount": str(row.amount)}
    db.delete(row)
    db.flush()
    audit_service.record(
        db, action="employee_insurance.delete", actor_user_id=actor_user_id,
        entity_type="employee", entity_id=employee_id, before=before,
    )
    return employee_id


def roster(db: Session, employees: list[Employee], day: date) -> dict[int, dict]:
    ids = [e.id for e in employees]
    out: dict[int, dict] = {}
    if not ids:
        return out
    versions: dict[int, list[EmployeeInsurance]] = {}
    for row in db.scalars(select(EmployeeInsurance).where(
            EmployeeInsurance.employee_id.in_(ids))
            .order_by(EmployeeInsurance.effective_from.desc())).all():
        versions.setdefault(row.employee_id, []).append(row)
    for emp_id, rows in versions.items():
        cur = next((r for r in rows if r.effective_from <= day), None)
        upcoming = next((r for r in reversed(rows) if r.effective_from > day), None)
        out[emp_id] = {
            "versions": len(rows),
            "amount": str(cur.amount) if cur else None,
            "effective_from": str(cur.effective_from) if cur else None,
            "upcoming": ({"amount": str(upcoming.amount),
                          "effective_from": str(upcoming.effective_from)}
                         if upcoming else None),
        }
    return out


def history(db: Session, employee_id: int) -> dict:
    versions = db.scalars(select(EmployeeInsurance).where(
        EmployeeInsurance.employee_id == employee_id)
        .order_by(EmployeeInsurance.effective_from.desc())).all()
    months = []
    seen: set[tuple[int, int]] = set()
    total = ZERO
    for run, line in _insurance_cells(db, employee_id):
        if run.status == PayrollRunStatus.reversed and (run.year, run.month) in seen:
            continue
        seen.add((run.year, run.month))
        value = to_money(Decimal(str(line.insurance_employee or 0)))
        if run.status == PayrollRunStatus.posted:
            total += value
        months.append({
            "year": run.year, "month": run.month, "run_id": run.id,
            "document_number": run.document_number, "status": run.status.value,
            "status_label": STATUS_LABELS.get(run.status, run.status.value),
            "amount": str(value), "manual": False,
            "salary_paid": bool(line.paid),
        })
    return {
        "employee_id": employee_id,
        "versions": [{
            "id": v.id, "effective_from": str(v.effective_from), "amount": str(v.amount),
            "notes": v.notes, "locked": used_by_posted(db, v),
            "created_at": v.created_at,
        } for v in versions],
        "months": months,
        "posted_total": str(to_money(total)),
    }


def move_legacy_component(db: Session) -> int:
    comp = db.scalar(select(SalaryComponent).where(SalaryComponent.name == LEGACY_COMPONENT))
    if comp is None:
        return 0
    moved = 0
    for line, salary in db.execute(
        select(EmployeeSalaryLine, EmployeeSalary)
        .join(EmployeeSalary, EmployeeSalary.id == EmployeeSalaryLine.salary_id)
        .where(EmployeeSalaryLine.component_id == comp.id)
    ).all():
        amount = to_money(Decimal(str(line.amount or 0)))
        exists = db.scalar(select(EmployeeInsurance).where(
            EmployeeInsurance.employee_id == salary.employee_id,
            EmployeeInsurance.effective_from == salary.effective_from))
        if exists is None and amount > 0:
            db.add(EmployeeInsurance(
                employee_id=salary.employee_id, effective_from=salary.effective_from,
                amount=amount, notes="منقول من بند «تأمينات» في كارت الراتب"))
            moved += 1
        db.delete(line)
    comp.active = False
    db.flush()
    return moved
