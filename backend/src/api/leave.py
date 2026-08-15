"""الأجازات — الأنواع والأرصدة والطلبات (HR-3)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_HR_READ, CAP_HR_WRITE
from src.core.db import get_db
from src.models.employee import Employee
from src.models.hr_leave import LeaveRequest, LeaveStatus, LeaveType
from src.services import leave_service
from src.services.leave_service import LeaveError

router = APIRouter(tags=["leave"], prefix="/hr/leave")


def _raise(exc: LeaveError):
    text = str(exc)
    if "غير موجود" in text or "غير موجودة" in text:
        raise HTTPException(404, {"code": "not_found", "message": text}) from exc
    if "مسير مرحّل" in text:
        raise HTTPException(409, {"code": "locked", "message": text}) from exc
    if "نفس الأيام" in text:
        raise HTTPException(409, {"code": "duplicate", "message": text}) from exc
    raise HTTPException(422, {"code": "validation", "message": text}) from exc


class TypeIn(BaseModel):
    name: str
    code: str | None = None
    annual_quota: Decimal = Decimal("0")
    paid: bool = True
    deducts_salary: bool = False
    affects_balance: bool = True
    requires_approval: bool = True
    counts_weekend: bool = False
    carry_over_max: Decimal | None = None
    notes: str | None = None


class TypeOut(BaseModel):
    id: int
    code: str
    name: str
    annual_quota: Decimal
    paid: bool
    deducts_salary: bool
    affects_balance: bool
    requires_approval: bool
    counts_weekend: bool
    active: bool


class RequestIn(BaseModel):
    employee_id: int
    leave_type_id: int
    date_from: date
    date_to: date
    reason: str | None = None


class RequestOut(BaseModel):
    id: int
    document_number: str
    employee_id: int
    employee_name: str | None = None
    leave_type_id: int
    leave_type: str | None = None
    date_from: date
    date_to: date
    days: Decimal
    reason: str | None
    status: LeaveStatus
    reject_reason: str | None


class EntitlementIn(BaseModel):
    employee_id: int
    leave_type_id: int
    year: int
    opening: Decimal | None = None
    entitled: Decimal | None = None
    adjustment: Decimal | None = None
    notes: str | None = None


def _req_out(db: Session, row: LeaveRequest) -> RequestOut:
    emp = db.get(Employee, row.employee_id)
    kind = db.get(LeaveType, row.leave_type_id)
    return RequestOut(
        id=row.id, document_number=row.document_number, employee_id=row.employee_id,
        employee_name=emp.name if emp else None, leave_type_id=row.leave_type_id,
        leave_type=kind.name if kind else None, date_from=row.date_from, date_to=row.date_to,
        days=row.days, reason=row.reason, status=row.status, reject_reason=row.reject_reason,
    )


# ------------------------------------------------------------- الأنواع


@router.get("/types", response_model=list[TypeOut])
def list_types(
    _: CurrentUser = Depends(require_capability(CAP_HR_READ)),
    db: Session = Depends(get_db),
) -> list[TypeOut]:
    return [TypeOut.model_validate(t, from_attributes=True)
            for t in db.scalars(select(LeaveType).order_by(LeaveType.code)).all()]


@router.post("/types", response_model=TypeOut, status_code=status.HTTP_201_CREATED)
def create_type(
    body: TypeIn,
    current: CurrentUser = Depends(require_capability(CAP_HR_WRITE)),
    db: Session = Depends(get_db),
) -> TypeOut:
    try:
        row = leave_service.create_type(db, actor_user_id=current.id, **body.model_dump())
    except LeaveError as exc:
        _raise(exc)
    out = TypeOut.model_validate(row, from_attributes=True)
    db.commit()
    return out


@router.delete("/types/{type_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_type(
    type_id: int,
    _: CurrentUser = Depends(require_capability(CAP_HR_WRITE)),
    db: Session = Depends(get_db),
) -> None:
    row = db.get(LeaveType, type_id)
    if row is None:
        raise HTTPException(404, {"code": "not_found", "message": "نوع الأجازة غير موجود."})
    row.active = False
    db.commit()


# ------------------------------------------------------------- الأرصدة


@router.get("/balances")
def balances(
    year: int = Query(...),
    employee_id: int | None = Query(None),
    _: CurrentUser = Depends(require_capability(CAP_HR_READ)),
    db: Session = Depends(get_db),
) -> list[dict]:
    """رصيد كل موظف في كل نوع — محسوب، مش مخزّن."""
    employees = db.scalars(
        select(Employee).where(Employee.id == employee_id) if employee_id
        else select(Employee).where(Employee.active.is_(True))
    ).all()
    types = db.scalars(select(LeaveType).where(LeaveType.active.is_(True))).all()
    out = []
    for emp in employees:
        for kind in types:
            state = leave_service.balance(
                db, employee_id=emp.id, leave_type_id=kind.id, year=year)
            state["employee_name"] = emp.name
            state["leave_type"] = kind.name
            out.append(state)
    return out


@router.post("/entitlements", status_code=status.HTTP_201_CREATED)
def set_entitlement(
    body: EntitlementIn,
    current: CurrentUser = Depends(require_capability(CAP_HR_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    try:
        leave_service.set_entitlement(db, actor_user_id=current.id, **body.model_dump())
    except LeaveError as exc:
        _raise(exc)
    result = leave_service.balance(
        db, employee_id=body.employee_id, leave_type_id=body.leave_type_id, year=body.year)
    db.commit()
    return result


# ------------------------------------------------------------- الطلبات


@router.get("/requests", response_model=list[RequestOut])
def list_requests(
    status_filter: LeaveStatus | None = Query(None, alias="status"),
    employee_id: int | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    _: CurrentUser = Depends(require_capability(CAP_HR_READ)),
    db: Session = Depends(get_db),
) -> list[RequestOut]:
    stmt = select(LeaveRequest).order_by(LeaveRequest.date_from.desc())
    if status_filter:
        stmt = stmt.where(LeaveRequest.status == status_filter)
    if employee_id:
        stmt = stmt.where(LeaveRequest.employee_id == employee_id)
    if date_from:
        stmt = stmt.where(LeaveRequest.date_to >= date_from)
    if date_to:
        stmt = stmt.where(LeaveRequest.date_from <= date_to)
    return [_req_out(db, r) for r in db.scalars(stmt).all()]


@router.post("/requests", response_model=RequestOut, status_code=status.HTTP_201_CREATED)
def create_request(
    body: RequestIn,
    current: CurrentUser = Depends(require_capability(CAP_HR_WRITE)),
    db: Session = Depends(get_db),
) -> RequestOut:
    try:
        row = leave_service.request(db, actor_user_id=current.id, **body.model_dump())
    except LeaveError as exc:
        _raise(exc)
    out = _req_out(db, row)
    db.commit()
    return out


@router.post("/requests/{request_id}/approve", response_model=RequestOut)
def approve_request(
    request_id: int,
    current: CurrentUser = Depends(require_capability(CAP_HR_WRITE)),
    db: Session = Depends(get_db),
) -> RequestOut:
    try:
        row = leave_service.approve(db, request_id=request_id, actor_user_id=current.id)
    except LeaveError as exc:
        _raise(exc)
    out = _req_out(db, row)
    db.commit()
    return out


class RejectIn(BaseModel):
    reason: str | None = None


@router.post("/requests/{request_id}/reject", response_model=RequestOut)
def reject_request(
    request_id: int,
    body: RejectIn,
    current: CurrentUser = Depends(require_capability(CAP_HR_WRITE)),
    db: Session = Depends(get_db),
) -> RequestOut:
    try:
        row = leave_service.reject(
            db, request_id=request_id, actor_user_id=current.id, reason=body.reason)
    except LeaveError as exc:
        _raise(exc)
    out = _req_out(db, row)
    db.commit()
    return out


@router.post("/requests/{request_id}/cancel", response_model=RequestOut)
def cancel_request(
    request_id: int,
    current: CurrentUser = Depends(require_capability(CAP_HR_WRITE)),
    db: Session = Depends(get_db),
) -> RequestOut:
    """بيلغي الطلب وبيشيل أيام الحضور اللي اتكتبت منه — مش بيمسح الطلب."""
    try:
        row = leave_service.cancel(db, request_id=request_id, actor_user_id=current.id)
    except LeaveError as exc:
        _raise(exc)
    out = _req_out(db, row)
    db.commit()
    return out
