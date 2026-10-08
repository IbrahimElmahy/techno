from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from src.auth import branch_scope
from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_HR_READ, CAP_HR_WRITE
from src.core.db import get_db
from src.lib.attendance_import import ColumnMap
from src.models.employee import Employee
from src.models.hr_attendance import (
    AttendanceDay,
    AttendanceImport,
    AttendanceStatus,
    Holiday,
    WorkShift,
)
from src.models.user import User
from src.services import attendance_service
from src.services.attendance_service import AttendanceError, AttendanceLocked

router = APIRouter(tags=["attendance"], prefix="/hr/attendance")


def _raise(exc: AttendanceError):
    if isinstance(exc, AttendanceLocked):
        raise HTTPException(409, {"code": "locked", "message": str(exc)}) from exc
    if "غير موجود" in str(exc) or "غير موجودة" in str(exc):
        raise HTTPException(404, {"code": "not_found", "message": str(exc)}) from exc
    raise HTTPException(422, {"code": "validation", "message": str(exc)}) from exc


def _own_employee(db: Session, current: CurrentUser, employee_id: int) -> None:
    if not branch_scope.may_touch_employee(db, current, employee_id):
        raise HTTPException(404, {"code": "not_found", "message": "الموظف غير موجود."})


def _import_branch(current: CurrentUser) -> int | None:
    return None if branch_scope.sees_all_branches(current) else current.branch_id


class ShiftIn(BaseModel):
    name: str
    start_time: str
    end_time: str
    break_minutes: int = 0
    grace_minutes: int = 0
    weekend_days: str = "4,5"
    is_default: bool = False


class ShiftOut(BaseModel):
    id: int
    name: str
    start_time: str
    end_time: str
    break_minutes: int
    grace_minutes: int
    weekend_days: str
    is_default: bool
    active: bool


class AssignIn(BaseModel):
    employee_id: int
    shift_id: int
    effective_from: date


class HolidayIn(BaseModel):
    name: str
    holiday_date: date
    paid: bool = True
    branch_id: int | None = None


class HolidayOut(BaseModel):
    id: int
    name: str
    holiday_date: date
    paid: bool
    branch_id: int | None
    active: bool


class DayIn(BaseModel):
    employee_id: int
    work_date: date
    check_in: str | None = None
    check_out: str | None = None
    status: AttendanceStatus | None = None
    notes: str | None = None


class DayOut(BaseModel):
    id: int
    employee_id: int
    employee_name: str | None = None
    work_date: date
    status: AttendanceStatus
    check_in: str | None
    check_out: str | None
    late_minutes: int
    early_leave_minutes: int
    worked_hours: Decimal
    overtime_hours: Decimal
    source: str
    locked: bool = False
    notes: str | None


class ImportIn(BaseModel):
    rows: list[list[str]]
    employee_column: int = 0
    date_column: int = 1
    time_column: int | None = 2
    check_in_column: int | None = None
    check_out_column: int | None = None
    filename: str | None = None

    def mapping(self) -> ColumnMap:
        return ColumnMap(
            employee=self.employee_column, day=self.date_column, time=self.time_column,
            check_in=self.check_in_column, check_out=self.check_out_column,
        )


def _day_out(db: Session, row: AttendanceDay, names: dict[int, str] | None = None) -> DayOut:
    name = (names or {}).get(row.employee_id)
    if name is None:
        emp = db.get(Employee, row.employee_id)
        name = emp.name if emp else None
    return DayOut(
        id=row.id, employee_id=row.employee_id, employee_name=name,
        work_date=row.work_date, status=row.status,
        check_in=row.check_in, check_out=row.check_out,
        late_minutes=row.late_minutes, early_leave_minutes=row.early_leave_minutes,
        worked_hours=row.worked_hours, overtime_hours=row.overtime_hours,
        source=row.source.value, locked=row.locked_by_payroll_run_id is not None,
        notes=row.notes,
    )


@router.get("/shifts", response_model=list[ShiftOut])
def list_shifts(
    _: CurrentUser = Depends(require_capability(CAP_HR_READ)),
    db: Session = Depends(get_db),
) -> list[ShiftOut]:
    return [ShiftOut.model_validate(s, from_attributes=True)
            for s in db.scalars(select(WorkShift).order_by(WorkShift.name)).all()]


@router.post("/shifts", response_model=ShiftOut, status_code=status.HTTP_201_CREATED)
def create_shift(
    body: ShiftIn,
    current: CurrentUser = Depends(require_capability(CAP_HR_WRITE)),
    db: Session = Depends(get_db),
) -> ShiftOut:
    try:
        shift = attendance_service.create_shift(db, actor_user_id=current.id, **body.model_dump())
    except AttendanceError as exc:
        _raise(exc)
    out = ShiftOut.model_validate(shift, from_attributes=True)
    db.commit()
    return out


@router.post("/shifts/assign", status_code=status.HTTP_201_CREATED)
def assign_shift(
    body: AssignIn,
    current: CurrentUser = Depends(require_capability(CAP_HR_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    _own_employee(db, current, body.employee_id)
    try:
        row = attendance_service.assign_shift(db, actor_user_id=current.id, **body.model_dump())
    except AttendanceError as exc:
        _raise(exc)
    result = {"id": row.id, "employee_id": row.employee_id, "shift_id": row.shift_id}
    db.commit()
    return result


@router.get("/holidays", response_model=list[HolidayOut])
def list_holidays(
    year: int | None = Query(None),
    current: CurrentUser = Depends(require_capability(CAP_HR_READ)),
    db: Session = Depends(get_db),
) -> list[HolidayOut]:
    stmt = select(Holiday).order_by(Holiday.holiday_date.desc(), Holiday.id.desc())
    stmt = branch_scope.scope(stmt, Holiday, current)
    if year:
        stmt = stmt.where(Holiday.holiday_date >= date(year, 1, 1),
                          Holiday.holiday_date <= date(year, 12, 31))
    return [HolidayOut.model_validate(h, from_attributes=True) for h in db.scalars(stmt).all()]


@router.post("/holidays", response_model=HolidayOut, status_code=status.HTTP_201_CREATED)
def add_holiday(
    body: HolidayIn,
    current: CurrentUser = Depends(require_capability(CAP_HR_WRITE)),
    db: Session = Depends(get_db),
) -> HolidayOut:
    data = body.model_dump()
    if not branch_scope.sees_all_branches(current):
        data["branch_id"] = current.branch_id
    try:
        row = attendance_service.add_holiday(db, actor_user_id=current.id, **data)
    except AttendanceError as exc:
        _raise(exc)
    out = HolidayOut.model_validate(row, from_attributes=True)
    db.commit()
    return out


@router.delete("/holidays/{holiday_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_holiday(
    holiday_id: int,
    current: CurrentUser = Depends(require_capability(CAP_HR_WRITE)),
    db: Session = Depends(get_db),
) -> None:
    row = db.get(Holiday, holiday_id)
    if row is None or not branch_scope.may_see(current, row):
        raise HTTPException(404, {"code": "not_found", "message": "العطلة غير موجودة."})
    if row.branch_id is None and not branch_scope.sees_all_branches(current):
        raise HTTPException(403, {"code": "forbidden",
                                  "message": "هذه العطلة عامة لكل الفروع — يكون إلغاؤها من الإدارة."})
    row.active = False
    db.commit()


@router.get("/days", response_model=list[DayOut])
def list_days(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    employee_id: int | None = Query(None),
    department_id: int | None = Query(None),
    current: CurrentUser = Depends(require_capability(CAP_HR_READ)),
    db: Session = Depends(get_db),
) -> list[DayOut]:
    stmt = select(AttendanceDay).order_by(
        AttendanceDay.work_date.desc(), AttendanceDay.employee_id)
    stmt = branch_scope.scope_by_employee(stmt, AttendanceDay.employee_id, current)
    if date_from:
        stmt = stmt.where(AttendanceDay.work_date >= date_from)
    if date_to:
        stmt = stmt.where(AttendanceDay.work_date <= date_to)
    if employee_id:
        stmt = stmt.where(AttendanceDay.employee_id == employee_id)
    if department_id:
        stmt = stmt.where(AttendanceDay.employee_id.in_(
            select(Employee.id).where(Employee.department_id == department_id)))
    rows = db.scalars(stmt).all()
    names = {e.id: e.name for e in db.scalars(select(Employee)).all()}
    return [_day_out(db, r, names) for r in rows]


@router.post("/days", response_model=DayOut, status_code=status.HTTP_201_CREATED)
def record_day(
    body: DayIn,
    current: CurrentUser = Depends(require_capability(CAP_HR_WRITE)),
    db: Session = Depends(get_db),
) -> DayOut:
    _own_employee(db, current, body.employee_id)
    try:
        row = attendance_service.record_day(db, actor_user_id=current.id, **body.model_dump())
    except AttendanceError as exc:
        _raise(exc)
    out = _day_out(db, row)
    db.commit()
    return out


@router.delete("/days/{day_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_day(
    day_id: int,
    current: CurrentUser = Depends(require_capability(CAP_HR_WRITE)),
    db: Session = Depends(get_db),
) -> None:
    day = db.get(AttendanceDay, day_id)
    if day is not None and not branch_scope.may_touch_employee(db, current, day.employee_id):
        raise HTTPException(404, {"code": "not_found", "message": "اليوم غير موجود."})
    try:
        attendance_service.delete_day(db, day_id=day_id, actor_user_id=current.id)
    except AttendanceError as exc:
        _raise(exc)
    db.commit()


@router.post("/import/preview")
def preview_import(
    body: ImportIn,
    current: CurrentUser = Depends(require_capability(CAP_HR_READ)),
    db: Session = Depends(get_db),
) -> dict:
    return attendance_service.preview_import(db, rows=body.rows, mapping=body.mapping(),
                                             branch_id=_import_branch(current))


@router.post("/import", status_code=status.HTTP_201_CREATED)
def apply_import(
    body: ImportIn,
    current: CurrentUser = Depends(require_capability(CAP_HR_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    result = attendance_service.apply_import(
        db, rows=body.rows, mapping=body.mapping(),
        actor_user_id=current.id, filename=body.filename,
        branch_id=_import_branch(current),
    )
    db.commit()
    return result


@router.get("/imports")
def list_imports(
    current: CurrentUser = Depends(require_capability(CAP_HR_READ)),
    db: Session = Depends(get_db),
) -> list[dict]:
    stmt = select(AttendanceImport).order_by(AttendanceImport.id.desc())
    branch_id = branch_scope.visible_branch_id(current)
    if branch_id is not None:
        stmt = stmt.outerjoin(User, User.id == AttendanceImport.actor_user_id).where(
            or_(User.branch_id == branch_id, User.branch_id.is_(None)))
    rows = db.scalars(stmt.limit(100)).all()
    return [{
        "id": r.id, "document_number": r.document_number, "filename": r.filename,
        "date_from": r.date_from, "date_to": r.date_to,
        "rows_total": r.rows_total, "rows_created": r.rows_created,
        "rows_updated": r.rows_updated, "rows_skipped": r.rows_skipped,
        "created_at": r.created_at,
    } for r in rows]
