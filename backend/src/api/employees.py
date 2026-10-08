from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_USER_READ, CAP_USER_WRITE
from src.core.db import get_db
from src.models.employee import Employee, JobTitle
from src.models.hr_org import Department
from src.services import hr_service, numbering
from src.services.hr_service import HrError
from src.auth import branch_scope

router = APIRouter(tags=["employees"], prefix="")


class JobTitleIn(BaseModel):
    name: str
    description: str | None = None


class JobTitleOut(BaseModel):
    id: int
    name: str
    description: str | None
    active: bool


class EmployeeIn(BaseModel):
    name: str
    job_title_id: int | None = None
    department: str | None = None
    department_id: int | None = None
    phone: str | None = None
    national_id: str | None = None
    hire_date: date | None = None
    salary: Decimal | None = None
    branch_id: int | None = None
    warehouse_id: int | None = None
    user_id: int | None = None
    notes: str | None = None
    address: str | None = None
    work_start: str | None = None
    work_end: str | None = None
    collection_commission_pct: Decimal | None = None


class EmployeePatch(BaseModel):
    name: str | None = None
    job_title_id: int | None = None
    department: str | None = None
    department_id: int | None = None
    phone: str | None = None
    national_id: str | None = None
    hire_date: date | None = None
    salary: Decimal | None = None
    branch_id: int | None = None
    warehouse_id: int | None = None
    user_id: int | None = None
    notes: str | None = None
    active: bool | None = None
    address: str | None = None
    work_start: str | None = None
    work_end: str | None = None
    collection_commission_pct: Decimal | None = None


class EmployeeOut(BaseModel):
    id: int
    code: str
    name: str
    job_title_id: int | None
    job_title: str | None = None
    department: str | None
    department_id: int | None = None
    phone: str | None
    national_id: str | None
    hire_date: date | None
    salary: Decimal | None
    branch_id: int | None
    warehouse_id: int | None = None
    user_id: int | None
    active: bool
    address: str | None = None
    work_start: str | None = None
    work_end: str | None = None
    collection_commission_pct: Decimal | None = None
    notes: str | None


def _out(db: Session, e: Employee) -> EmployeeOut:
    title = db.get(JobTitle, e.job_title_id) if e.job_title_id else None
    return EmployeeOut(
        id=e.id, code=e.code, name=e.name, job_title_id=e.job_title_id,
        job_title=title.name if title else None,
        department=(dept.name if (dept := (db.get(Department, e.department_id)
                                          if e.department_id else None)) else e.department),
        department_id=e.department_id, phone=e.phone,
        national_id=e.national_id, hire_date=e.hire_date, salary=e.salary,
        address=getattr(e, "address", None), work_start=getattr(e, "work_start", None),
        work_end=getattr(e, "work_end", None),
        collection_commission_pct=getattr(e, "collection_commission_pct", None),
        branch_id=e.branch_id, warehouse_id=e.warehouse_id,
        user_id=e.user_id, active=e.active, notes=e.notes,
    )


@router.get("/job-titles", response_model=list[JobTitleOut])
def list_job_titles(
    _: CurrentUser = Depends(require_capability(CAP_USER_READ)),
    db: Session = Depends(get_db),
) -> list[JobTitleOut]:
    rows = db.scalars(select(JobTitle).order_by(JobTitle.name)).all()
    return [JobTitleOut(id=t.id, name=t.name, description=t.description, active=t.active)
            for t in rows]


@router.post("/job-titles", response_model=JobTitleOut, status_code=status.HTTP_201_CREATED)
def create_job_title(
    body: JobTitleIn,
    _: CurrentUser = Depends(require_capability(CAP_USER_WRITE)),
    db: Session = Depends(get_db),
) -> JobTitleOut:
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(422, {"code": "validation", "message": "اسم الوظيفة مطلوب."})
    if db.scalar(select(JobTitle).where(JobTitle.name == name)):
        raise HTTPException(409, {"code": "duplicate", "message": "هذه الوظيفة موجودة بالفعل."})
    title = JobTitle(name=name, description=body.description)
    db.add(title)
    db.commit()
    return JobTitleOut(id=title.id, name=title.name, description=title.description,
                       active=title.active)


@router.delete("/job-titles/{title_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_job_title(
    title_id: int,
    _: CurrentUser = Depends(require_capability(CAP_USER_WRITE)),
    db: Session = Depends(get_db),
) -> None:
    title = db.get(JobTitle, title_id)
    if title is None:
        raise HTTPException(404, {"code": "not_found", "message": "الوظيفة غير موجودة."})
    title.active = False
    db.commit()


@router.get("/employees", response_model=list[EmployeeOut])
def list_employees(
    active: bool | None = Query(None),
    branch_id: int | None = Query(None),
    job_title_id: int | None = Query(None),
    department_id: int | None = Query(None),
    current: CurrentUser = Depends(require_capability(CAP_USER_READ)),
    db: Session = Depends(get_db),
) -> list[EmployeeOut]:
    stmt = branch_scope.scope(select(Employee), Employee, current)
    if active is not None:
        stmt = stmt.where(Employee.active.is_(active))
    if branch_id:
        stmt = stmt.where(Employee.branch_id == branch_id)
    if job_title_id:
        stmt = stmt.where(Employee.job_title_id == job_title_id)
    if department_id:
        stmt = stmt.where(Employee.department_id == department_id)
    rows = db.scalars(stmt.order_by(Employee.name)).all()
    _titles = db.scalars(select(JobTitle)).all()  # noqa: F841
    _depts = db.scalars(select(Department)).all()  # noqa: F841
    return [_out(db, e) for e in rows]


def _check_department(db: Session, department_id: int | None, current_id: int | None = None) -> None:
    if department_id is None or department_id == current_id:
        return
    dept = db.get(Department, department_id)
    if dept is None:
        raise HTTPException(422, {"code": "validation", "message": "القسم المختار غير موجود."})
    if not dept.active:
        raise HTTPException(422, {"code": "validation",
                                  "message": f"القسم «{dept.name}» مغلق — فعّله أولاً أو اختر قسماً آخر."})


@router.post("/employees", response_model=EmployeeOut, status_code=status.HTTP_201_CREATED)
def create_employee(
    body: EmployeeIn,
    current: CurrentUser = Depends(require_capability(CAP_USER_WRITE)),
    db: Session = Depends(get_db),
) -> EmployeeOut:
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(422, {"code": "validation", "message": "اسم الموظف مطلوب."})
    if body.user_id and db.scalar(select(Employee).where(Employee.user_id == body.user_id)):
        raise HTTPException(409, {"code": "duplicate",
                                  "message": "هذا المستخدم مرتبط بموظف آخر."})
    _check_department(db, body.department_id)
    emp = Employee(
        code=numbering.next_document_number(db, Employee, "EMP", column=Employee.code, width=4),
        name=name, job_title_id=body.job_title_id,
        department=body.department, department_id=body.department_id, phone=body.phone, national_id=body.national_id,
        hire_date=body.hire_date, salary=body.salary,
        branch_id=_new_employee_branch(current, body.branch_id),
        warehouse_id=body.warehouse_id,
        user_id=body.user_id, notes=body.notes,
        address=body.address, work_start=body.work_start, work_end=body.work_end,
        collection_commission_pct=body.collection_commission_pct,
    )
    db.add(emp)
    db.commit()
    return _out(db, emp)


def _new_employee_branch(current: CurrentUser, requested: int | None) -> int | None:
    if not branch_scope.sees_all_branches(current):
        return current.branch_id
    return requested if requested is not None else branch_scope.visible_branch_id(current)


def _check_branch_move(current: CurrentUser, emp: Employee, changes: dict) -> None:
    if "branch_id" not in changes or branch_scope.sees_all_branches(current):
        return
    target = changes["branch_id"]
    if target == emp.branch_id:
        return
    if target != current.branch_id:
        raise HTTPException(403, {"code": "forbidden",
                                  "message": "نقل الموظف إلى فرع آخر من الإدارة فقط."})


def _seen_employee(db: Session, employee_id: int, current: CurrentUser) -> Employee:
    emp = db.scalar(branch_scope.scope(
        select(Employee).where(Employee.id == employee_id), Employee, current))
    if emp is None:
        raise HTTPException(404, {"code": "not_found", "message": "الموظف غير موجود."})
    return emp


@router.get("/employees/{employee_id}", response_model=EmployeeOut)
def get_employee(
    employee_id: int,
    current: CurrentUser = Depends(require_capability(CAP_USER_READ)),
    db: Session = Depends(get_db),
) -> EmployeeOut:
    emp = _seen_employee(db, employee_id, current)
    return _out(db, emp)


@router.patch("/employees/{employee_id}", response_model=EmployeeOut)
def update_employee(
    employee_id: int,
    body: EmployeePatch,
    current: CurrentUser = Depends(require_capability(CAP_USER_WRITE)),
    db: Session = Depends(get_db),
) -> EmployeeOut:
    emp = _seen_employee(db, employee_id, current)
    changes = body.model_dump(exclude_unset=True)
    _check_branch_move(current, emp, changes)
    if "department_id" in changes:
        _check_department(db, changes["department_id"], emp.department_id)
    for field, value in changes.items():
        setattr(emp, field, value)
    db.commit()
    return _out(db, emp)


@router.delete("/employees/{employee_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_employee(
    employee_id: int,
    hard: bool = Query(False),
    current: CurrentUser = Depends(require_capability(CAP_USER_WRITE)),
    db: Session = Depends(get_db),
) -> None:
    emp = _seen_employee(db, employee_id, current)
    if hard:
        try:
            hr_service.delete_employee(db, employee=emp, actor_user_id=current.id)
        except HrError as exc:
            raise HTTPException(409, {"code": "has_history", "message": str(exc)}) from exc
        db.commit()
        return
    emp.active = False
    db.commit()
