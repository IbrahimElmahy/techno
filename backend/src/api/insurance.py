from __future__ import annotations

import re
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from src.auth import branch_scope
from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_PAYROLL_POST, CAP_PAYROLL_READ, CAP_SALARY_VIEW
from src.core.db import get_db
from src.models.employee import Employee
from src.models.hr_org import Department
from src.models.hr_payroll import EmployeeInsurance
from src.models.hr_payroll_run import PayrollRemittance
from src.services import insurance_service, payroll_service
from src.services.insurance_service import InsuranceError
from src.services.ledger_service import LedgerError
from src.services.payroll_service import PayrollError

router = APIRouter(tags=["insurance"], prefix="/hr/insurance")


_DIAC = re.compile("[\u064b-\u0652\u0670]")


def _has(text: str, needle: str) -> bool:
    return _DIAC.sub("", needle) in _DIAC.sub("", text)


def _raise(exc: Exception):
    text = str(exc)
    if isinstance(exc, LedgerError):
        raise HTTPException(409, {"code": "ledger_invalid", "message": text}) from exc
    if _has(text, "غير موجود"):
        raise HTTPException(404, {"code": "not_found", "message": text}) from exc
    if _has(text, "مرحّل"):
        raise HTTPException(409, {"code": "locked", "message": text}) from exc
    raise HTTPException(422, {"code": "validation", "message": text}) from exc


def _seen_employee(db: Session, employee_id: int, current: CurrentUser) -> Employee:
    emp = db.get(Employee, employee_id)
    if emp is None or not branch_scope.may_see(current, emp):
        raise HTTPException(404, {"code": "not_found", "message": "الموظف غير موجود."})
    return emp


def _target_branch(current: CurrentUser, requested: int | None) -> int | None:
    if branch_scope.sees_all_branches(current):
        return requested if requested is not None else branch_scope.visible_branch_id(current)
    if requested is not None and requested != current.branch_id:
        raise HTTPException(404, {"code": "not_found", "message": "الفرع غير موجود."})
    return current.branch_id


class InsuranceIn(BaseModel):
    employee_id: int
    effective_from: date
    amount: Decimal
    notes: str | None = None


class RemitIn(BaseModel):
    amount: Decimal
    remit_date: date
    branch_id: int | None = None
    treasury_id: int | None = None
    notes: str | None = None


@router.get("")
def roster(
    branch_id: int | None = Query(None),
    include_inactive: bool = Query(False),
    current: CurrentUser = Depends(require_capability(CAP_SALARY_VIEW)),
    db: Session = Depends(get_db),
) -> list[dict]:
    stmt = branch_scope.scope(select(Employee), Employee, current)
    if not include_inactive:
        stmt = stmt.where(Employee.active.is_(True))
    if branch_id:
        stmt = stmt.where(Employee.branch_id == branch_id)
    employees = db.scalars(stmt.order_by(Employee.name)).all()
    depts = {d.id: d.name for d in db.scalars(select(Department)).all()}
    data = insurance_service.roster(db, list(employees), date.today())
    return [{
        "employee_id": e.id, "code": e.code, "name": e.name, "active": e.active,
        "branch_id": e.branch_id,
        "department": depts.get(e.department_id) if e.department_id else e.department,
        **(data.get(e.id) or {"versions": 0, "amount": None, "effective_from": None,
                              "upcoming": None}),
    } for e in employees]


@router.get("/employees/{employee_id}")
def employee_history(
    employee_id: int,
    current: CurrentUser = Depends(require_capability(CAP_SALARY_VIEW)),
    db: Session = Depends(get_db),
) -> dict:
    emp = _seen_employee(db, employee_id, current)
    cur = insurance_service.amount_on(db, employee_id, date.today())
    return insurance_service.history(db, employee_id) | {
        "name": emp.name, "code": emp.code,
        "current": ({"amount": str(cur.amount), "effective_from": str(cur.effective_from)}
                    if cur else None),
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def set_amount(
    body: InsuranceIn,
    current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
    db: Session = Depends(get_db),
) -> dict:
    _seen_employee(db, body.employee_id, current)
    try:
        row = insurance_service.set_amount(db, actor_user_id=current.id, **body.model_dump())
    except InsuranceError as exc:
        _raise(exc)
    out = {"id": row.id, "employee_id": row.employee_id,
           "effective_from": str(row.effective_from), "amount": str(row.amount)}
    db.commit()
    return out


@router.delete("/versions/{insurance_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_version(
    insurance_id: int,
    current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
    db: Session = Depends(get_db),
) -> None:
    row = db.get(EmployeeInsurance, insurance_id)
    if row is None:
        raise HTTPException(404, {"code": "not_found", "message": "سجل التأمينات غير موجود."})
    _seen_employee(db, row.employee_id, current)
    try:
        insurance_service.delete_version(db, insurance_id=insurance_id, actor_user_id=current.id)
    except InsuranceError as exc:
        _raise(exc)
    db.commit()


@router.get("/remittances")
def list_remittances(
    current: CurrentUser = Depends(require_capability(CAP_PAYROLL_READ)),
    db: Session = Depends(get_db),
) -> list[dict]:
    stmt = select(PayrollRemittance).where(PayrollRemittance.kind == "insurance") \
        .order_by(PayrollRemittance.remit_date.desc(), PayrollRemittance.id.desc())
    branch = branch_scope.visible_branch_id(current)
    if branch is not None:
        if branch_scope.sees_all_branches(current):
            stmt = stmt.where(or_(PayrollRemittance.branch_id == branch,
                                  PayrollRemittance.branch_id.is_(None)))
        else:
            stmt = stmt.where(PayrollRemittance.branch_id == branch)
    return [{
        "id": r.id, "document_number": r.document_number, "amount": str(r.amount),
        "remit_date": r.remit_date, "branch_id": r.branch_id, "treasury_id": r.treasury_id,
        "notes": r.notes, "ledger_entry_id": r.ledger_entry_id,
    } for r in db.scalars(stmt).all()]


@router.post("/remittances", status_code=status.HTTP_201_CREATED)
def create_remittance(
    body: RemitIn,
    current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
    db: Session = Depends(get_db),
) -> dict:
    payload = body.model_dump()
    payload["branch_id"] = _target_branch(current, body.branch_id)
    try:
        row = payroll_service.remit(db, kind="insurance", actor_user_id=current.id, **payload)
    except (PayrollError, LedgerError) as exc:
        _raise(exc)
    out = {"id": row.id, "document_number": row.document_number, "amount": str(row.amount),
           "ledger_entry_id": row.ledger_entry_id}
    db.commit()
    return out
