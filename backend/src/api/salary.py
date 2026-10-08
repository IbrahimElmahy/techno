from __future__ import annotations

import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth import branch_scope
from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_PAYROLL_POST, CAP_SALARY_VIEW
from src.core.db import get_db
from src.models.employee import Employee
from src.models.hr_payroll_run import PayrollRun
from src.services import salary_service as svc
from src.services.ledger_service import LedgerError
from src.services.salary_service import SalaryError

router = APIRouter(tags=["salary"], prefix="/hr/salary")

_DIAC = re.compile("[ً-ْٰ]")


def _has(text: str, needle: str) -> bool:
    return _DIAC.sub("", needle) in _DIAC.sub("", text)


def _raise(exc: Exception):
    text = str(exc)
    if isinstance(exc, LedgerError):
        raise HTTPException(409, {"code": "ledger_invalid", "message": text}) from exc
    if _has(text, "غير موجود"):
        raise HTTPException(404, {"code": "not_found", "message": text}) from exc
    if any(_has(text, s) for s in ("مرحّل", "ملغاة")):
        raise HTTPException(409, {"code": "locked", "message": text}) from exc
    raise HTTPException(422, {"code": "validation", "message": text}) from exc


def _branch(current: CurrentUser, requested: int | None) -> int:
    if branch_scope.sees_all_branches(current):
        branch = requested if requested is not None else branch_scope.visible_branch_id(current)
        if branch is None:
            raise HTTPException(422, {"code": "validation", "message": "اختر الفرع."})
        return branch
    if requested is not None and requested != current.branch_id:
        raise HTTPException(404, {"code": "not_found", "message": "الفرع غير موجود."})
    if current.branch_id is None:
        raise HTTPException(422, {"code": "validation", "message": "اختر الفرع."})
    return current.branch_id


def _employee(db: Session, employee_id: int, current: CurrentUser) -> Employee:
    emp = db.get(Employee, employee_id)
    if emp is None or not branch_scope.may_touch_employee(db, current, employee_id):
        raise HTTPException(404, {"code": "not_found", "message": "الموظف غير موجود."})
    return emp


def _run(db: Session, run_id: int, current: CurrentUser) -> PayrollRun:
    run = db.get(PayrollRun, run_id)
    if run is None or not (branch_scope.sees_all_branches(current)
                           or run.branch_id == current.branch_id):
        raise HTTPException(404, {"code": "not_found", "message": "مرتبات الشهر غير موجودة."})
    return run


@router.get("/employees")
def employees(
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
    rows = db.scalars(stmt.order_by(Employee.name)).all()
    return svc.roster(db, list(rows), date.today())


@router.get("/employees/{employee_id}")
def employee_card(
    employee_id: int,
    current: CurrentUser = Depends(require_capability(CAP_SALARY_VIEW)),
    db: Session = Depends(get_db),
) -> dict:
    return svc.card(db, _employee(db, employee_id, current))


@router.get("/employees/{employee_id}/commission")
def commission_preview(
    employee_id: int,
    year: int,
    month: int,
    current: CurrentUser = Depends(require_capability(CAP_SALARY_VIEW)),
    db: Session = Depends(get_db),
) -> list[dict]:
    return svc.commission_preview(db, _employee(db, employee_id, current), year, month)


class ItemIn(BaseModel):
    name: str
    kind: str = "earning"
    amount: float | str | None = None


class RuleIn(BaseModel):
    basis: str = "sales"
    pct: float | str | None = None
    notes: str | None = None


class CardIn(BaseModel):
    effective_from: date
    basic: float | str
    items: list[ItemIn] = []
    insurance: float | str | None = None
    rules: list[RuleIn] = []
    notes: str | None = None


@router.put("/employees/{employee_id}")
def save_card(
    employee_id: int,
    body: CardIn,
    current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
    db: Session = Depends(get_db),
) -> dict:
    emp = _employee(db, employee_id, current)
    try:
        out = svc.save_card(
            db, employee=emp, effective_from=body.effective_from, basic=body.basic,
            items=[i.model_dump() for i in body.items], insurance=body.insurance,
            rules=[r.model_dump() for r in body.rules], notes=body.notes,
            actor_user_id=current.id)
    except SalaryError as exc:
        _raise(exc)
    db.commit()
    return out


@router.get("/month")
def month(
    year: int,
    month: int,
    branch_id: int | None = Query(None),
    current: CurrentUser = Depends(require_capability(CAP_SALARY_VIEW)),
    db: Session = Depends(get_db),
) -> dict:
    return svc.month_out(db, branch_id=_branch(current, branch_id), year=year, month=month)


class MonthIn(BaseModel):
    year: int
    month: int
    branch_id: int | None = None


@router.post("/month/calculate")
def calculate(
    body: MonthIn,
    current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
    db: Session = Depends(get_db),
) -> dict:
    branch = _branch(current, body.branch_id)
    try:
        svc.calculate(db, branch_id=branch, year=body.year, month=body.month,
                      actor_user_id=current.id)
    except SalaryError as exc:
        _raise(exc)
    db.commit()
    return svc.month_out(db, branch_id=branch, year=body.year, month=body.month)


class LineIn(BaseModel):
    commission_override: float | str | None = None
    absent_override: float | str | None = None
    extra_earning: float | str | None = None
    extra_deduction: float | str | None = None
    notes: str | None = None


@router.patch("/month/{run_id}/employees/{employee_id}")
def update_line(
    run_id: int,
    employee_id: int,
    body: LineIn,
    current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
    db: Session = Depends(get_db),
) -> dict:
    run = _run(db, run_id, current)
    try:
        svc.update_line(db, run_id=run.id, employee_id=employee_id,
                        fields=body.model_dump(exclude_unset=True), actor_user_id=current.id)
    except SalaryError as exc:
        _raise(exc)
    db.commit()
    return svc.month_out(db, branch_id=run.branch_id, year=run.year, month=run.month)


@router.delete("/month/{run_id}/employees/{employee_id}")
def remove_line(run_id: int, employee_id: int,
                current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
                db: Session = Depends(get_db)) -> dict:
    run = _run(db, run_id, current)
    try:
        svc.remove_line(db, run_id=run.id, employee_id=employee_id, actor_user_id=current.id)
    except SalaryError as exc:
        _raise(exc)
    db.commit()
    return svc.month_out(db, branch_id=run.branch_id, year=run.year, month=run.month)


@router.post("/month/{run_id}/employees/{employee_id}")
def add_line(run_id: int, employee_id: int,
             current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
             db: Session = Depends(get_db)) -> dict:
    run = _run(db, run_id, current)
    try:
        svc.add_line(db, run_id=run.id, employee_id=employee_id, actor_user_id=current.id)
    except SalaryError as exc:
        _raise(exc)
    db.commit()
    return svc.month_out(db, branch_id=run.branch_id, year=run.year, month=run.month)


@router.post("/month/{run_id}/post")
def post(run_id: int, current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
         db: Session = Depends(get_db)) -> dict:
    run = _run(db, run_id, current)
    try:
        svc.post(db, run_id=run.id, actor_user_id=current.id)
    except (SalaryError, LedgerError) as exc:
        _raise(exc)
    db.commit()
    return svc.month_out(db, branch_id=run.branch_id, year=run.year, month=run.month)


@router.post("/month/{run_id}/unpost")
def unpost(run_id: int, current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
           db: Session = Depends(get_db)) -> dict:
    run = _run(db, run_id, current)
    try:
        svc.unpost(db, run_id=run.id, actor_user_id=current.id)
    except (SalaryError, LedgerError) as exc:
        _raise(exc)
    db.commit()
    return svc.month_out(db, branch_id=run.branch_id, year=run.year, month=run.month)


class PayIn(BaseModel):
    treasury_id: int | None = None
    pay_date: date | None = None
    employee_ids: list[int] | None = None


@router.post("/month/{run_id}/pay")
def pay(run_id: int, body: PayIn,
        current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
        db: Session = Depends(get_db)) -> dict:
    run = _run(db, run_id, current)
    try:
        svc.pay(db, run_id=run.id, actor_user_id=current.id, treasury_id=body.treasury_id,
                pay_date=body.pay_date, employee_ids=body.employee_ids)
    except (SalaryError, LedgerError) as exc:
        _raise(exc)
    db.commit()
    return svc.month_out(db, branch_id=run.branch_id, year=run.year, month=run.month)


@router.post("/month/{run_id}/employees/{employee_id}/unpay")
def unpay(run_id: int, employee_id: int,
          current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
          db: Session = Depends(get_db)) -> dict:
    run = _run(db, run_id, current)
    try:
        n = svc.unpay(db, run_id=run.id, employee_id=employee_id, actor_user_id=current.id)
    except (SalaryError, LedgerError) as exc:
        _raise(exc)
    db.commit()
    return {**svc.month_out(db, branch_id=run.branch_id, year=run.year, month=run.month),
            "unpaid": n}


@router.delete("/month/{run_id}")
def delete_month(run_id: int,
                 current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
                 db: Session = Depends(get_db)) -> dict:
    run = _run(db, run_id, current)
    try:
        svc.delete_draft(db, run_id=run.id, actor_user_id=current.id)
    except SalaryError as exc:
        _raise(exc)
    db.commit()
    return {"deleted": run_id}


@router.get("/month/{run_id}/payslip/{employee_id}")
def payslip(run_id: int, employee_id: int,
            current: CurrentUser = Depends(require_capability(CAP_SALARY_VIEW)),
            db: Session = Depends(get_db)) -> dict:
    _run(db, run_id, current)
    try:
        return svc.payslip(db, run_id=run_id, employee_id=employee_id)
    except SalaryError as exc:
        _raise(exc)


def _scoped_employee_ids(db: Session, current: CurrentUser, branch_id: int | None) -> list[int]:
    stmt = branch_scope.scope(select(Employee.id), Employee, current)
    if branch_id:
        stmt = stmt.where(Employee.branch_id == branch_id)
    return list(db.scalars(stmt).all())


@router.get("/adjustments")
def list_adjustments(
    branch_id: int | None = Query(None),
    year: int | None = Query(None),
    month: int | None = Query(None),
    current: CurrentUser = Depends(require_capability(CAP_SALARY_VIEW)),
    db: Session = Depends(get_db),
) -> list[dict]:
    return svc.list_adjustments(db, employee_ids=_scoped_employee_ids(db, current, branch_id),
                                year=year, month=month)


class AdjustmentIn(BaseModel):
    employee_id: int
    kind: str
    basis: str = "amount"
    amount: float | str | None = None
    quantity: float | str | None = None
    year: int
    month: int
    reason: str | None = None


@router.post("/adjustments")
def create_adjustment(body: AdjustmentIn,
                      current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
                      db: Session = Depends(get_db)) -> dict:
    emp = _employee(db, body.employee_id, current)
    try:
        out = svc.save_adjustment(db, emp=emp, data=body.model_dump(), actor_user_id=current.id)
    except SalaryError as exc:
        _raise(exc)
    db.commit()
    return out


@router.put("/adjustments/{adjustment_id}")
def update_adjustment(adjustment_id: int, body: AdjustmentIn,
                      current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
                      db: Session = Depends(get_db)) -> dict:
    emp = _employee(db, body.employee_id, current)
    _adjustment_seen(db, adjustment_id, current)
    try:
        out = svc.save_adjustment(db, emp=emp, data=body.model_dump(), actor_user_id=current.id,
                                  adjustment_id=adjustment_id)
    except SalaryError as exc:
        _raise(exc)
    db.commit()
    return out


def _adjustment_seen(db: Session, adjustment_id: int, current: CurrentUser) -> None:
    from src.models.hr_advance import PayrollAdjustment

    row = db.get(PayrollAdjustment, adjustment_id)
    if row is None:
        raise HTTPException(404, {"code": "not_found", "message": "الحركة غير موجودة."})
    _employee(db, row.employee_id, current)


@router.delete("/adjustments/{adjustment_id}")
def delete_adjustment(adjustment_id: int,
                      current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
                      db: Session = Depends(get_db)) -> dict:
    _adjustment_seen(db, adjustment_id, current)
    try:
        svc.delete_adjustment(db, adjustment_id=adjustment_id, actor_user_id=current.id)
    except SalaryError as exc:
        _raise(exc)
    db.commit()
    return {"deleted": adjustment_id}


@router.get("/leaves")
def list_leaves(
    branch_id: int | None = Query(None),
    year: int | None = Query(None),
    month: int | None = Query(None),
    current: CurrentUser = Depends(require_capability(CAP_SALARY_VIEW)),
    db: Session = Depends(get_db),
) -> list[dict]:
    return svc.list_leaves(db, employee_ids=_scoped_employee_ids(db, current, branch_id),
                           year=year, month=month)


class LeaveIn(BaseModel):
    employee_id: int
    paid: bool = True
    date_from: date
    date_to: date
    reason: str | None = None


def _leave_seen(db: Session, leave_id: int, current: CurrentUser) -> None:
    from src.models.hr_leave import LeaveRequest

    row = db.get(LeaveRequest, leave_id)
    if row is None:
        raise HTTPException(404, {"code": "not_found", "message": "الإجازة غير موجودة."})
    _employee(db, row.employee_id, current)


@router.post("/leaves")
def create_leave(body: LeaveIn,
                 current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
                 db: Session = Depends(get_db)) -> dict:
    emp = _employee(db, body.employee_id, current)
    try:
        out = svc.save_leave(db, emp=emp, paid=body.paid, date_from=body.date_from,
                             date_to=body.date_to, reason=body.reason, actor_user_id=current.id)
    except SalaryError as exc:
        _raise(exc)
    db.commit()
    return out


@router.put("/leaves/{leave_id}")
def update_leave(leave_id: int, body: LeaveIn,
                 current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
                 db: Session = Depends(get_db)) -> dict:
    emp = _employee(db, body.employee_id, current)
    _leave_seen(db, leave_id, current)
    try:
        out = svc.save_leave(db, emp=emp, paid=body.paid, date_from=body.date_from,
                             date_to=body.date_to, reason=body.reason, actor_user_id=current.id,
                             leave_id=leave_id)
    except SalaryError as exc:
        _raise(exc)
    db.commit()
    return out


@router.delete("/leaves/{leave_id}")
def delete_leave(leave_id: int,
                 current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
                 db: Session = Depends(get_db)) -> dict:
    _leave_seen(db, leave_id, current)
    try:
        svc.delete_leave(db, leave_id=leave_id, actor_user_id=current.id)
    except SalaryError as exc:
        _raise(exc)
    db.commit()
    return {"deleted": leave_id}
