from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth import branch_scope
from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_HR_READ, CAP_PAYROLL_POST, CAP_SALARY_VIEW
from src.core.db import get_db
from src.models.employee import Employee, JobTitle
from src.models.hr_org import Department
from src.models.hr_payroll import (
    ComponentCalc,
    ComponentKind,
    EmployeeSalary,
    EmployeeSalaryLine,
    PayMethod,
    SalaryComponent,
)
from src.services import insurance_service
from src.services import payroll_setup_service as setup
from src.services.payroll_setup_service import PayrollSetupError

router = APIRouter(tags=["payroll-setup"], prefix="/hr/payroll")


def _raise(exc: PayrollSetupError):
    text = str(exc)
    if "غير موجود" in text or "غير موجودة" in text:
        raise HTTPException(404, {"code": "not_found", "message": text}) from exc
    if "اتحسب عليه مسير مرحّل" in text or "احتُسب عليه مسير مرحّل" in text:
        raise HTTPException(409, {"code": "locked", "message": text}) from exc
    raise HTTPException(422, {"code": "validation", "message": text}) from exc


class ComponentIn(BaseModel):
    name: str
    kind: ComponentKind
    code: str | None = None
    calc: ComponentCalc = ComponentCalc.fixed
    account_id: int | None = None
    sort_order: int = 0
    notes: str | None = None


class ComponentOut(BaseModel):
    id: int
    code: str
    name: str
    kind: ComponentKind
    calc: ComponentCalc
    account_id: int | None
    active: bool


class SalaryLineIn(BaseModel):
    component_id: int
    amount: Decimal = Decimal("0")
    pct: Decimal | None = None
    notes: str | None = None


class SalaryIn(BaseModel):
    employee_id: int
    effective_from: date
    basic: Decimal
    payment_method: PayMethod | None = None
    bank_name: str | None = None
    bank_account: str | None = None
    lines: list[SalaryLineIn] | None = None
    notes: str | None = None


class SettingsIn(BaseModel):
    days_per_month: int | None = None
    hours_per_day: Decimal | None = None


@router.get("/components", response_model=list[ComponentOut])
def list_components(
    _: CurrentUser = Depends(require_capability(CAP_HR_READ)),
    db: Session = Depends(get_db),
) -> list[ComponentOut]:
    return [ComponentOut.model_validate(c, from_attributes=True)
            for c in db.scalars(select(SalaryComponent).order_by(SalaryComponent.code)).all()]


@router.post("/components", response_model=ComponentOut, status_code=status.HTTP_201_CREATED)
def create_component(
    body: ComponentIn,
    current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
    db: Session = Depends(get_db),
) -> ComponentOut:
    try:
        row = setup.create_component(db, actor_user_id=current.id, **body.model_dump())
    except PayrollSetupError as exc:
        _raise(exc)
    out = ComponentOut.model_validate(row, from_attributes=True)
    db.commit()
    return out


@router.delete("/components/{component_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_component(
    component_id: int,
    _: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
    db: Session = Depends(get_db),
) -> None:
    row = db.get(SalaryComponent, component_id)
    if row is None:
        raise HTTPException(404, {"code": "not_found", "message": "البند غير موجود."})
    row.active = False
    db.commit()


@router.get("/salaries")
def list_salaries(
    include_inactive: bool = Query(False),
    branch_id: int | None = Query(None),
    current: CurrentUser = Depends(require_capability(CAP_SALARY_VIEW)),
    db: Session = Depends(get_db),
) -> list[dict]:
    stmt = branch_scope.scope(select(Employee), Employee, current)
    if not include_inactive:
        stmt = stmt.where(Employee.active.is_(True))
    if branch_id:
        stmt = stmt.where(Employee.branch_id == branch_id)
    employees = db.scalars(stmt.order_by(Employee.name)).all()
    titles = {t.id: t.name for t in db.scalars(select(JobTitle)).all()}
    depts = {d.id: d.name for d in db.scalars(select(Department)).all()}
    roster = setup.salary_roster(db, list(employees), date.today())
    insurance = insurance_service.roster(db, list(employees), date.today())
    out = []
    for e in employees:
        entry = roster.get(e.id) or {"versions": 0, "current": None, "upcoming": None}
        out.append({
            "employee_id": e.id, "code": e.code, "name": e.name, "active": e.active,
            "branch_id": e.branch_id,
            "department": depts.get(e.department_id) if e.department_id else e.department,
            "job_title": titles.get(e.job_title_id) if e.job_title_id else None,
            "hire_date": str(e.hire_date) if e.hire_date else None,
            "card_salary": str(e.salary) if e.salary is not None else None,
            "insurance": (insurance.get(e.id) or {}).get("amount"),
            **entry,
        })
    return out


def _seen_employee(db: Session, employee_id: int, current: CurrentUser) -> Employee:
    emp = db.get(Employee, employee_id)
    if emp is None or not branch_scope.may_see(current, emp):
        raise HTTPException(404, {"code": "not_found", "message": "الموظف غير موجود."})
    return emp


@router.get("/salaries/{employee_id}")
def employee_salary(
    employee_id: int,
    on: date | None = Query(None),
    current: CurrentUser = Depends(require_capability(CAP_SALARY_VIEW)),
    db: Session = Depends(get_db),
) -> dict:
    _seen_employee(db, employee_id, current)
    active = setup.salary_on(db, employee_id, on or date.today())
    history = db.scalars(
        select(EmployeeSalary)
        .where(EmployeeSalary.employee_id == employee_id)
        .order_by(EmployeeSalary.effective_from.desc())
    ).all()
    raw_lines = db.scalars(select(EmployeeSalaryLine).where(
        EmployeeSalaryLine.salary_id == active.id)).all() if active else []
    return {
        "employee_id": employee_id,
        "current": (setup.salary_breakdown(db, active) | {
            "id": active.id, "effective_from": str(active.effective_from),
            "payment_method": active.payment_method.value,
            "bank_name": active.bank_name, "bank_account": active.bank_account,
            "notes": active.notes,
            "lines": [{"component_id": x.component_id, "amount": str(x.amount),
                       "pct": str(x.pct) if x.pct is not None else None, "notes": x.notes}
                      for x in raw_lines],
        }) if active else None,
        "history": [
            {"id": h.id, "effective_from": str(h.effective_from), "basic": str(h.basic),
             "locked": setup.used_by_posted_run(db, h)}
            for h in history
        ],
    }


@router.delete("/salaries/versions/{salary_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_salary(
    salary_id: int,
    current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
    db: Session = Depends(get_db),
) -> None:
    row = db.get(EmployeeSalary, salary_id)
    if row is None:
        raise HTTPException(404, {"code": "not_found", "message": "هيكل الراتب غير موجود."})
    _seen_employee(db, row.employee_id, current)
    try:
        setup.delete_salary(db, salary_id=salary_id, actor_user_id=current.id)
    except PayrollSetupError as exc:
        _raise(exc)
    db.commit()


@router.post("/salaries", status_code=status.HTTP_201_CREATED)
def set_salary(
    body: SalaryIn,
    current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
    db: Session = Depends(get_db),
) -> dict:
    _seen_employee(db, body.employee_id, current)
    payload = body.model_dump()
    payload["lines"] = [line for line in (payload.get("lines") or [])] \
        if body.lines is not None else None
    try:
        row = setup.set_salary(db, actor_user_id=current.id, **payload)
    except PayrollSetupError as exc:
        _raise(exc)
    out = setup.salary_breakdown(db, row) | {
        "id": row.id, "effective_from": str(row.effective_from)}
    db.commit()
    return out


def _settings_out(row) -> dict:
    return {
        "days_per_month": row.days_per_month, "hours_per_day": str(row.hours_per_day),
    }


@router.get("/settings")
def read_settings(
    _: CurrentUser = Depends(require_capability(CAP_HR_READ)),
    db: Session = Depends(get_db),
) -> dict:
    out = _settings_out(setup.settings(db))
    db.commit()
    return out


@router.patch("/settings")
def update_settings(
    body: SettingsIn,
    current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
    db: Session = Depends(get_db),
) -> dict:
    row = setup.update_settings(
        db, actor_user_id=current.id, **body.model_dump(exclude_unset=True))
    out = _settings_out(row)
    db.commit()
    return out
