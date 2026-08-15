"""السلف والجزاءات (HR-5)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_PAYROLL_POST, CAP_SALARY_VIEW
from src.core.db import get_db
from src.models.employee import Employee
from src.models.hr_advance import (
    AdjustmentBasis,
    AdjustmentKind,
    AdjustmentStatus,
    AdvanceStatus,
    EmployeeAdvance,
    EmployeeAdvanceInstalment,
    PayrollAdjustment,
)
from src.services import advance_service
from src.services.advance_service import AdvanceError
from src.services.ledger_service import LedgerError

router = APIRouter(tags=["advances"], prefix="/hr")


def _raise(exc: Exception):
    text = str(exc)
    if isinstance(exc, LedgerError):
        raise HTTPException(409, {"code": "ledger_invalid", "message": text}) from exc
    if "غير موجود" in text or "غير موجودة" in text:
        raise HTTPException(404, {"code": "not_found", "message": text}) from exc
    if "مسير مرحّل" in text:
        raise HTTPException(409, {"code": "locked", "message": text}) from exc
    raise HTTPException(422, {"code": "validation", "message": text}) from exc


class AdvanceIn(BaseModel):
    employee_id: int
    amount: Decimal
    advance_date: date
    instalments: int = 1
    start_year: int | None = None
    start_month: int | None = None
    reason: str | None = None
    treasury_id: int | None = None
    branch_id: int | None = None
    cost_center_id: int | None = None


class AdjustmentIn(BaseModel):
    employee_id: int
    kind: AdjustmentKind
    year: int
    month: int
    basis: AdjustmentBasis = AdjustmentBasis.amount
    quantity: Decimal | None = None
    amount: Decimal = Decimal("0")
    reason: str | None = None


def _advance_out(db: Session, a: EmployeeAdvance) -> dict:
    emp = db.get(Employee, a.employee_id)
    parts = db.scalars(
        select(EmployeeAdvanceInstalment)
        .where(EmployeeAdvanceInstalment.advance_id == a.id)
        .order_by(EmployeeAdvanceInstalment.year, EmployeeAdvanceInstalment.month)
    ).all()
    return {
        "id": a.id, "document_number": a.document_number,
        "employee_id": a.employee_id, "employee_name": emp.name if emp else None,
        "advance_date": a.advance_date, "amount": str(a.amount),
        "instalments": a.instalments, "instalment_amount": str(a.instalment_amount),
        "start_year": a.start_year, "start_month": a.start_month,
        "reason": a.reason, "status": a.status.value,
        "ledger_entry_id": a.ledger_entry_id,
        # المتبقي محسوب من الأقساط اللي اتخصمت — مش عمود مخزّن بيفرق أول ما مسير يتعكس.
        "taken": str(advance_service.taken_of(db, a.id)),
        "outstanding": str(advance_service.outstanding_of(db, a)),
        "schedule": [
            {"year": p.year, "month": p.month, "amount": str(p.amount),
             "paid": p.payroll_line_id is not None}
            for p in parts
        ],
    }


def _adjustment_out(db: Session, r: PayrollAdjustment) -> dict:
    emp = db.get(Employee, r.employee_id)
    return {
        "id": r.id, "document_number": r.document_number,
        "employee_id": r.employee_id, "employee_name": emp.name if emp else None,
        "kind": r.kind.value, "basis": r.basis.value,
        "quantity": str(r.quantity) if r.quantity is not None else None,
        "amount": str(r.amount), "year": r.year, "month": r.month,
        "reason": r.reason, "status": r.status.value,
        "applied": r.payroll_line_id is not None,
    }


# ------------------------------------------------------------- السلف


@router.get("/advances")
def list_advances(
    employee_id: int | None = Query(None),
    status_filter: AdvanceStatus | None = Query(None, alias="status"),
    _: CurrentUser = Depends(require_capability(CAP_SALARY_VIEW)),
    db: Session = Depends(get_db),
) -> list[dict]:
    stmt = select(EmployeeAdvance).order_by(EmployeeAdvance.advance_date.desc())
    if employee_id:
        stmt = stmt.where(EmployeeAdvance.employee_id == employee_id)
    if status_filter:
        stmt = stmt.where(EmployeeAdvance.status == status_filter)
    return [_advance_out(db, a) for a in db.scalars(stmt).all()]


@router.post("/advances", status_code=status.HTTP_201_CREATED)
def create_advance(
    body: AdvanceIn,
    current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
    db: Session = Depends(get_db),
) -> dict:
    """بتتصرف من الخزنة وبتتقيد **أصل** — مدين سلف العاملين / دائن الخزنة."""
    try:
        row = advance_service.create_advance(db, actor_user_id=current.id, **body.model_dump())
    except (AdvanceError, LedgerError) as exc:
        _raise(exc)
    out = _advance_out(db, row)
    db.commit()
    return out


@router.post("/advances/{advance_id}/cancel")
def cancel_advance(
    advance_id: int,
    current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
    db: Session = Depends(get_db),
) -> dict:
    """بيلغي السلفة ويعكس قيدها — لو مااتخصمش منها قسط في مسير مرحّل."""
    try:
        row = advance_service.cancel_advance(
            db, advance_id=advance_id, actor_user_id=current.id)
    except (AdvanceError, LedgerError) as exc:
        _raise(exc)
    out = _advance_out(db, row)
    db.commit()
    return out


# ------------------------------------------------------------- الجزاءات


@router.get("/adjustments")
def list_adjustments(
    employee_id: int | None = Query(None),
    year: int | None = Query(None),
    month: int | None = Query(None),
    kind: AdjustmentKind | None = Query(None),
    _: CurrentUser = Depends(require_capability(CAP_SALARY_VIEW)),
    db: Session = Depends(get_db),
) -> list[dict]:
    stmt = select(PayrollAdjustment).order_by(
        PayrollAdjustment.year.desc(), PayrollAdjustment.month.desc())
    if employee_id:
        stmt = stmt.where(PayrollAdjustment.employee_id == employee_id)
    if year:
        stmt = stmt.where(PayrollAdjustment.year == year)
    if month:
        stmt = stmt.where(PayrollAdjustment.month == month)
    if kind:
        stmt = stmt.where(PayrollAdjustment.kind == kind)
    return [_adjustment_out(db, r) for r in db.scalars(stmt).all()]


@router.post("/adjustments", status_code=status.HTTP_201_CREATED)
def create_adjustment(
    body: AdjustmentIn,
    current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
    db: Session = Depends(get_db),
) -> dict:
    """جزاء أو مكافأة على شهر بعينه — الاتنين نفس الشكل بإشارة عكسية."""
    try:
        row = advance_service.create_adjustment(
            db, actor_user_id=current.id, **body.model_dump())
    except AdvanceError as exc:
        _raise(exc)
    out = _adjustment_out(db, row)
    db.commit()
    return out


@router.post("/adjustments/{adjustment_id}/cancel")
def cancel_adjustment(
    adjustment_id: int,
    current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
    db: Session = Depends(get_db),
) -> dict:
    try:
        row = advance_service.cancel_adjustment(
            db, adjustment_id=adjustment_id, actor_user_id=current.id)
    except AdvanceError as exc:
        _raise(exc)
    out = _adjustment_out(db, row)
    db.commit()
    return out


@router.get("/adjustments/status-values")
def adjustment_status_values(
    _: CurrentUser = Depends(require_capability(CAP_SALARY_VIEW)),
) -> list[str]:
    return [s.value for s in AdjustmentStatus]
