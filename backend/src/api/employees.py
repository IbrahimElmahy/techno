"""الموظفون والوظائف router (B8).

Master data, so it is edited and deactivated directly — unlike a posted document, an employee
record has no ledger consequence to preserve. Deactivating rather than deleting keeps the name
readable on whatever already references it.
"""
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
from src.services import numbering

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
    # `department` النص الحر فاضل مقبول عشان أي مستهلك قديم مايتكسرش؛ `department_id` هو الحقيقة.
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
        # الاسم اللي بيرجع هو اسم القسم المربوط لو موجود، وإلا النص القديم — فالشاشات والتطبيق
        # مش محتاجين يتغيّروا عشان الترحيل.
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


# ----------------------------------------------------------------- job titles


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
        raise HTTPException(409, {"code": "duplicate", "message": "الوظيفة دي موجودة."})
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


# ------------------------------------------------------------------ employees


@router.get("/employees", response_model=list[EmployeeOut])
def list_employees(
    active: bool | None = Query(None),
    branch_id: int | None = Query(None),
    job_title_id: int | None = Query(None),
    _: CurrentUser = Depends(require_capability(CAP_USER_READ)),
    db: Session = Depends(get_db),
) -> list[EmployeeOut]:
    stmt = select(Employee)
    if active is not None:
        stmt = stmt.where(Employee.active.is_(active))
    if branch_id:
        stmt = stmt.where(Employee.branch_id == branch_id)
    if job_title_id:
        stmt = stmt.where(Employee.job_title_id == job_title_id)
    rows = db.scalars(stmt.order_by(Employee.name)).all()
    return [_out(db, e) for e in rows]


@router.post("/employees", response_model=EmployeeOut, status_code=status.HTTP_201_CREATED)
def create_employee(
    body: EmployeeIn,
    _: CurrentUser = Depends(require_capability(CAP_USER_WRITE)),
    db: Session = Depends(get_db),
) -> EmployeeOut:
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(422, {"code": "validation", "message": "اسم الموظف مطلوب."})
    if body.user_id and db.scalar(select(Employee).where(Employee.user_id == body.user_id)):
        raise HTTPException(409, {"code": "duplicate",
                                  "message": "المستخدم ده مربوط بموظف تاني."})
    # كان بيعدّ الصفوف — وده بالظبط الغلط اللي `numbering` اتكتبت عشانه: امسح موظف واحد من
    # تلاتة، العدد يقول اتنين، فالتالي بياخد `EMP-0003` وهو موجود على التالت. والعمود unique،
    # فالحفظ بيفشل — وبيفضل فاشل، لأن العدد عالق ورا واحد للأبد.
    emp = Employee(
        code=numbering.next_document_number(db, Employee, "EMP", column=Employee.code, width=4),
        name=name, job_title_id=body.job_title_id,
        department=body.department, department_id=body.department_id, phone=body.phone, national_id=body.national_id,
        hire_date=body.hire_date, salary=body.salary, branch_id=body.branch_id,
        warehouse_id=body.warehouse_id,
        user_id=body.user_id, notes=body.notes,
        address=body.address, work_start=body.work_start, work_end=body.work_end,
        collection_commission_pct=body.collection_commission_pct,
    )
    db.add(emp)
    db.commit()
    return _out(db, emp)


@router.get("/employees/{employee_id}", response_model=EmployeeOut)
def get_employee(
    employee_id: int,
    _: CurrentUser = Depends(require_capability(CAP_USER_READ)),
    db: Session = Depends(get_db),
) -> EmployeeOut:
    emp = db.get(Employee, employee_id)
    if emp is None:
        raise HTTPException(404, {"code": "not_found", "message": "الموظف غير موجود."})
    return _out(db, emp)


@router.patch("/employees/{employee_id}", response_model=EmployeeOut)
def update_employee(
    employee_id: int,
    body: EmployeePatch,
    _: CurrentUser = Depends(require_capability(CAP_USER_WRITE)),
    db: Session = Depends(get_db),
) -> EmployeeOut:
    emp = db.get(Employee, employee_id)
    if emp is None:
        raise HTTPException(404, {"code": "not_found", "message": "الموظف غير موجود."})
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(emp, field, value)
    db.commit()
    return _out(db, emp)


@router.delete("/employees/{employee_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_employee(
    employee_id: int,
    _: CurrentUser = Depends(require_capability(CAP_USER_WRITE)),
    db: Session = Depends(get_db),
) -> None:
    """Deactivated, not deleted — the name must stay readable wherever it is already referenced."""
    emp = db.get(Employee, employee_id)
    if emp is None:
        raise HTTPException(404, {"code": "not_found", "message": "الموظف غير موجود."})
    emp.active = False
    db.commit()
