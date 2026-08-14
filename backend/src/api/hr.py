"""الموارد البشرية — الأقسام ونهاية الخدمة (HR-1)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_HR_READ, CAP_HR_WRITE
from src.core.db import get_db
from src.models.employee import Employee
from src.models.hr_org import Department, EmployeeTermination, TerminationKind
from src.services import hr_service
from src.services.hr_service import HrError

router = APIRouter(tags=["hr"], prefix="/hr")


# ----------------------------------------------------------------- schemas


class DepartmentIn(BaseModel):
    name: str
    code: str | None = None
    parent_id: int | None = None
    manager_employee_id: int | None = None
    cost_center_id: int | None = None
    branch_id: int | None = None
    notes: str | None = None


class DepartmentPatch(BaseModel):
    name: str | None = None
    parent_id: int | None = None
    manager_employee_id: int | None = None
    cost_center_id: int | None = None
    branch_id: int | None = None
    notes: str | None = None
    active: bool | None = None


class DepartmentOut(BaseModel):
    id: int
    code: str
    name: str
    parent_id: int | None
    parent_name: str | None = None
    manager_employee_id: int | None
    manager_name: str | None = None
    cost_center_id: int | None
    branch_id: int | None
    active: bool
    notes: str | None
    employee_count: int = 0


class TerminationIn(BaseModel):
    employee_id: int
    end_date: date
    kind: TerminationKind
    last_working_day: date | None = None
    reason: str | None = None
    settlement_amount: Decimal | None = None


class TerminationOut(BaseModel):
    id: int
    employee_id: int
    employee_name: str | None = None
    end_date: date
    last_working_day: date | None
    kind: TerminationKind
    reason: str | None
    settlement_amount: Decimal | None


def _counts(db: Session) -> dict[int, int]:
    """عدد الموظفين النشطين في كل قسم — استعلام واحد مش واحد لكل صف."""
    rows = db.execute(
        select(Employee.department_id, func.count())
        .where(Employee.department_id.is_not(None), Employee.active.is_(True))
        .group_by(Employee.department_id)
    ).all()
    return {dept_id: n for dept_id, n in rows}


def _dept_out(db: Session, d: Department, counts: dict[int, int] | None = None) -> DepartmentOut:
    parent = db.get(Department, d.parent_id) if d.parent_id else None
    manager = db.get(Employee, d.manager_employee_id) if d.manager_employee_id else None
    counts = counts if counts is not None else _counts(db)
    return DepartmentOut(
        id=d.id, code=d.code, name=d.name, parent_id=d.parent_id,
        parent_name=parent.name if parent else None,
        manager_employee_id=d.manager_employee_id,
        manager_name=manager.name if manager else None,
        cost_center_id=d.cost_center_id, branch_id=d.branch_id,
        active=d.active, notes=d.notes, employee_count=counts.get(d.id, 0),
    )


def _term_out(db: Session, t: EmployeeTermination) -> TerminationOut:
    emp = db.get(Employee, t.employee_id)
    return TerminationOut(
        id=t.id, employee_id=t.employee_id, employee_name=emp.name if emp else None,
        end_date=t.end_date, last_working_day=t.last_working_day, kind=t.kind,
        reason=t.reason, settlement_amount=t.settlement_amount,
    )


# ------------------------------------------------------------- الأقسام


@router.get("/departments", response_model=list[DepartmentOut])
def list_departments(
    active_only: bool = Query(False),
    _: CurrentUser = Depends(require_capability(CAP_HR_READ)),
    db: Session = Depends(get_db),
) -> list[DepartmentOut]:
    stmt = select(Department).order_by(Department.code)
    if active_only:
        stmt = stmt.where(Department.active.is_(True))
    counts = _counts(db)
    return [_dept_out(db, d, counts) for d in db.scalars(stmt).all()]


@router.post("/departments", response_model=DepartmentOut, status_code=status.HTTP_201_CREATED)
def create_department(
    body: DepartmentIn,
    current: CurrentUser = Depends(require_capability(CAP_HR_WRITE)),
    db: Session = Depends(get_db),
) -> DepartmentOut:
    try:
        dept = hr_service.create_department(
            db, actor_user_id=current.id, **body.model_dump())
    except HrError as exc:
        raise HTTPException(422, {"code": "validation", "message": str(exc)}) from exc
    out = _dept_out(db, dept)
    db.commit()
    return out


@router.get("/departments/{department_id}", response_model=DepartmentOut)
def get_department(
    department_id: int,
    _: CurrentUser = Depends(require_capability(CAP_HR_READ)),
    db: Session = Depends(get_db),
) -> DepartmentOut:
    dept = db.get(Department, department_id)
    if dept is None:
        raise HTTPException(404, {"code": "not_found", "message": "القسم غير موجود."})
    return _dept_out(db, dept)


@router.patch("/departments/{department_id}", response_model=DepartmentOut)
def update_department(
    department_id: int,
    body: DepartmentPatch,
    current: CurrentUser = Depends(require_capability(CAP_HR_WRITE)),
    db: Session = Depends(get_db),
) -> DepartmentOut:
    try:
        dept = hr_service.update_department(
            db, department_id=department_id, actor_user_id=current.id,
            **body.model_dump(exclude_unset=True))
    except HrError as exc:
        code = "not_found" if "غير موجود" in str(exc) else "validation"
        raise HTTPException(404 if code == "not_found" else 422,
                            {"code": code, "message": str(exc)}) from exc
    out = _dept_out(db, dept)
    db.commit()
    return out


@router.delete("/departments/{department_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_department(
    department_id: int,
    current: CurrentUser = Depends(require_capability(CAP_HR_WRITE)),
    db: Session = Depends(get_db),
) -> None:
    """بيتقفل، مابيتمسحش (FR-023)."""
    try:
        hr_service.deactivate_department(
            db, department_id=department_id, actor_user_id=current.id)
    except HrError as exc:
        if "غير موجود" in str(exc):
            raise HTTPException(404, {"code": "not_found", "message": str(exc)}) from exc
        raise HTTPException(409, {"code": "validation", "message": str(exc)}) from exc
    db.commit()


@router.post("/departments/import-from-employees", status_code=status.HTTP_201_CREATED)
def import_departments(
    current: CurrentUser = Depends(require_capability(CAP_HR_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    """بيحوّل نص «القسم» القديم لأقسام حقيقية — مرة واحدة، وبضغطة من المستخدم."""
    result = hr_service.import_departments_from_employees(db, actor_user_id=current.id)
    db.commit()
    return result


# ------------------------------------------------------ نهاية الخدمة


@router.get("/terminations", response_model=list[TerminationOut])
def list_terminations(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    _: CurrentUser = Depends(require_capability(CAP_HR_READ)),
    db: Session = Depends(get_db),
) -> list[TerminationOut]:
    stmt = select(EmployeeTermination).order_by(EmployeeTermination.end_date.desc())
    if date_from:
        stmt = stmt.where(EmployeeTermination.end_date >= date_from)
    if date_to:
        stmt = stmt.where(EmployeeTermination.end_date <= date_to)
    return [_term_out(db, t) for t in db.scalars(stmt).all()]


@router.post("/terminations", response_model=TerminationOut,
             status_code=status.HTTP_201_CREATED)
def terminate_employee(
    body: TerminationIn,
    current: CurrentUser = Depends(require_capability(CAP_HR_WRITE)),
    db: Session = Depends(get_db),
) -> TerminationOut:
    try:
        row = hr_service.terminate(db, actor_user_id=current.id, **body.model_dump())
    except HrError as exc:
        if "غير موجود" in str(exc):
            raise HTTPException(404, {"code": "not_found", "message": str(exc)}) from exc
        code = "duplicate" if "قبل كده" in str(exc) else "validation"
        raise HTTPException(409 if code == "duplicate" else 422,
                            {"code": code, "message": str(exc)}) from exc
    out = _term_out(db, row)
    db.commit()
    return out


@router.delete("/terminations/{employee_id}", status_code=status.HTTP_204_NO_CONTENT)
def reinstate_employee(
    employee_id: int,
    current: CurrentUser = Depends(require_capability(CAP_HR_WRITE)),
    db: Session = Depends(get_db),
) -> None:
    """بيلغي نهاية خدمة اتسجّلت بالغلط — ده تصحيح إدخال مش حذف بيانات."""
    try:
        hr_service.reinstate(db, employee_id=employee_id, actor_user_id=current.id)
    except HrError as exc:
        raise HTTPException(404, {"code": "not_found", "message": str(exc)}) from exc
    db.commit()
