from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.money import to_money
from src.models.employee import Employee
from src.models.hr_payroll import (
    ComponentCalc,
    ComponentKind,
    EmployeeSalary,
    EmployeeSalaryLine,
    PayrollSetting,
    SalaryComponent,
)
from src.services import audit_service, numbering


class PayrollSetupError(Exception):
    pass


def create_component(
    db: Session, *, name: str, kind: ComponentKind, actor_user_id: int,
    code: str | None = None, calc: ComponentCalc = ComponentCalc.fixed,
    account_id: int | None = None,
    sort_order: int = 0, notes: str | None = None,
) -> SalaryComponent:
    clean = (name or "").strip()
    if not clean:
        raise PayrollSetupError("اسم البند مطلوب.")
    if db.scalar(select(SalaryComponent).where(SalaryComponent.name == clean)):
        raise PayrollSetupError("يوجد بند بالاسم نفسه.")
    row = SalaryComponent(
        code=(code or "").strip() or numbering.next_document_number(
            db, SalaryComponent, "SC", column=SalaryComponent.code, width=3),
        name=clean, kind=kind, calc=calc,
        account_id=account_id, sort_order=sort_order, notes=notes,
    )
    db.add(row)
    db.flush()
    audit_service.record(
        db, action="salary_component.create", actor_user_id=actor_user_id,
        entity_type="salary_component", entity_id=row.id,
        after={"name": clean, "kind": kind.value},
    )
    return row


def set_salary(
    db: Session, *, employee_id: int, effective_from: date, basic, actor_user_id: int,
    lines: list[dict] | None = None, notes: str | None = None,
    payment_method=None, bank_name: str | None = None, bank_account: str | None = None,
) -> EmployeeSalary:
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise PayrollSetupError("الموظف غير موجود.")
    if to_money(Decimal(str(basic or 0))) < 0:
        raise PayrollSetupError("لا يمكن أن يكون الأساسي سالباً.")

    row = db.scalar(select(EmployeeSalary).where(
        EmployeeSalary.employee_id == employee_id,
        EmployeeSalary.effective_from == effective_from))
    if row is not None and used_by_posted_run(db, row):
        raise PayrollSetupError(
            f"هيكل الراتب الساري من {effective_from} احتُسب عليه مسير مرحّل — "
            "يُسجَّل أي تغيير بتاريخ سريان جديد (زيادة)، لا بتعديل القديم.")
    if row is None:
        row = EmployeeSalary(employee_id=employee_id, effective_from=effective_from)
        db.add(row)
    row.basic = basic
    row.notes = notes
    row.actor_user_id = actor_user_id
    if payment_method is not None:
        row.payment_method = payment_method
    if bank_name is not None:
        row.bank_name = bank_name
    if bank_account is not None:
        row.bank_account = bank_account
    db.flush()

    if lines is not None:
        for old in db.scalars(select(EmployeeSalaryLine).where(
                EmployeeSalaryLine.salary_id == row.id)).all():
            db.delete(old)
        db.flush()
        for entry in lines:
            component_id = entry.get("component_id")
            if db.get(SalaryComponent, component_id) is None:
                raise PayrollSetupError("بند الراتب غير موجود.")
            db.add(EmployeeSalaryLine(
                salary_id=row.id, component_id=component_id,
                amount=entry.get("amount") or 0, pct=entry.get("pct"),
                notes=entry.get("notes"),
            ))
        db.flush()

    current = salary_on(db, employee_id, date.today())
    if current is not None and current.id == row.id:
        employee.salary = row.basic

    audit_service.record(
        db, action="employee_salary.set", actor_user_id=actor_user_id,
        entity_type="employee", entity_id=employee_id,
        after={"from": str(effective_from), "basic": str(row.basic)},
    )
    return row


def salary_on(db: Session, employee_id: int, day: date) -> EmployeeSalary | None:
    return db.scalar(
        select(EmployeeSalary)
        .where(EmployeeSalary.employee_id == employee_id,
               EmployeeSalary.effective_from <= day)
        .order_by(EmployeeSalary.effective_from.desc())
    )


def salary_breakdown(db: Session, salary: EmployeeSalary) -> dict:
    basic = to_money(Decimal(str(salary.basic or 0)))
    earnings, deductions = [], []

    lines = db.scalars(select(EmployeeSalaryLine).where(
        EmployeeSalaryLine.salary_id == salary.id)).all()
    for line in lines:
        component = db.get(SalaryComponent, line.component_id)
        if component is None or not component.active:
            continue
        if line.pct is not None:
            amount = to_money(basic * Decimal(str(line.pct)) / Decimal("100"))
        else:
            amount = to_money(Decimal(str(line.amount or 0)))
        entry = {"component_id": component.id, "name": component.name,
                 "kind": component.kind.value, "amount": str(amount)}
        if component.kind == ComponentKind.earning:
            earnings.append(entry)
        else:
            deductions.append(entry)

    earned = basic + sum(Decimal(e["amount"]) for e in earnings)
    return {
        "basic": str(basic),
        "earnings": earnings,
        "deductions": deductions,
        "gross": str(to_money(earned)),
    }


def used_by_posted_run(db: Session, salary: EmployeeSalary) -> bool:
    from src.models.hr_payroll_run import PayrollLine, PayrollRun, PayrollRunStatus

    months = db.execute(
        select(PayrollRun.year, PayrollRun.month)
        .join(PayrollLine, PayrollLine.run_id == PayrollRun.id)
        .where(PayrollLine.employee_id == salary.employee_id,
               PayrollRun.status == PayrollRunStatus.posted)
    ).all()
    for year, month in months:
        end = date(year + (month == 12), month % 12 + 1, 1)
        in_force = salary_on(db, salary.employee_id, date.fromordinal(end.toordinal() - 1))
        if in_force is not None and in_force.id == salary.id:
            return True
    return False


def delete_salary(db: Session, *, salary_id: int, actor_user_id: int) -> int:
    row = db.get(EmployeeSalary, salary_id)
    if row is None:
        raise PayrollSetupError("هيكل الراتب غير موجود.")
    if used_by_posted_run(db, row):
        raise PayrollSetupError(
            f"هيكل الراتب الساري من {row.effective_from} احتُسب عليه مسير مرحّل — "
            "لا يمكن حذفه. إن تغيّر الراتب فأنشئ نسخة جديدة بتاريخ سريان جديد.")
    employee_id = row.employee_id
    before = {"from": str(row.effective_from), "basic": str(row.basic)}
    for line in db.scalars(select(EmployeeSalaryLine).where(
            EmployeeSalaryLine.salary_id == row.id)).all():
        db.delete(line)
    db.flush()
    db.delete(row)
    db.flush()

    employee = db.get(Employee, employee_id)
    current = salary_on(db, employee_id, date.today())
    if employee is not None and current is not None:
        employee.salary = current.basic

    audit_service.record(
        db, action="employee_salary.delete", actor_user_id=actor_user_id,
        entity_type="employee", entity_id=employee_id, before=before,
    )
    return employee_id


def salary_roster(db: Session, employees: list[Employee], day: date) -> dict[int, dict]:
    ids = [e.id for e in employees]
    if not ids:
        return {}
    versions: dict[int, list[EmployeeSalary]] = {}
    for row in db.scalars(
        select(EmployeeSalary).where(EmployeeSalary.employee_id.in_(ids))
        .order_by(EmployeeSalary.effective_from.desc())
    ).all():
        versions.setdefault(row.employee_id, []).append(row)

    current_ids = []
    picked: dict[int, tuple[EmployeeSalary, EmployeeSalary | None, int]] = {}
    for emp_id, rows in versions.items():
        cur = next((r for r in rows if r.effective_from <= day), None)
        upcoming = next((r for r in reversed(rows) if r.effective_from > day), None)
        picked[emp_id] = (cur, upcoming, len(rows))
        if cur is not None:
            current_ids.append(cur.id)

    components = {c.id: c for c in db.scalars(select(SalaryComponent)).all()}
    lines: dict[int, list[EmployeeSalaryLine]] = {}
    if current_ids:
        for line in db.scalars(select(EmployeeSalaryLine).where(
                EmployeeSalaryLine.salary_id.in_(current_ids))).all():
            lines.setdefault(line.salary_id, []).append(line)

    out: dict[int, dict] = {}
    for emp_id, (cur, upcoming, count) in picked.items():
        entry: dict = {"versions": count, "current": None, "upcoming": None}
        if upcoming is not None:
            entry["upcoming"] = {"id": upcoming.id, "effective_from": str(upcoming.effective_from),
                                 "basic": str(upcoming.basic)}
        if cur is not None:
            basic = to_money(Decimal(str(cur.basic or 0)))
            earnings = deductions = Decimal("0")
            for line in lines.get(cur.id, []):
                component = components.get(line.component_id)
                if component is None or not component.active:
                    continue
                amount = (to_money(basic * Decimal(str(line.pct)) / Decimal("100"))
                          if line.pct is not None else to_money(Decimal(str(line.amount or 0))))
                if component.kind == ComponentKind.earning:
                    earnings += amount
                else:
                    deductions += amount
            entry["current"] = {
                "id": cur.id, "effective_from": str(cur.effective_from),
                "basic": str(basic), "allowances": str(to_money(earnings)),
                "deductions": str(to_money(deductions)),
                "gross": str(to_money(basic + earnings)),
                "net_structure": str(to_money(basic + earnings - deductions)),
                "payment_method": cur.payment_method.value,
            }
        out[emp_id] = entry
    return out


def settings(db: Session) -> PayrollSetting:
    row = db.scalar(select(PayrollSetting).order_by(PayrollSetting.id.desc()))
    if row is None:
        row = PayrollSetting()
        db.add(row)
        db.flush()
    return row


def update_settings(db: Session, *, actor_user_id: int, **fields) -> PayrollSetting:
    current = settings(db)
    for key, value in fields.items():
        if value is not None:
            setattr(current, key, value)
    current.actor_user_id = actor_user_id
    db.flush()
    audit_service.record(
        db, action="payroll_setting.update", actor_user_id=actor_user_id,
        entity_type="payroll_setting", entity_id=current.id, after=fields,
    )
    return current
