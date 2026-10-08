"""السلف والجزاءات (HR-5)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_HR_READ, CAP_PAYROLL_POST, CAP_SALARY_VIEW
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
from src.services import advance_service, employee_dues_service
from src.services.advance_service import AdvanceError
from src.services.ledger_service import LedgerError
from src.auth import branch_scope

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


class AdvanceUpdateIn(BaseModel):
    amount: Decimal
    advance_date: date
    instalments: int = 1
    start_year: int | None = None
    start_month: int | None = None
    reason: str | None = None
    treasury_id: int | None = None
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


# ------------------------------------------------------------- عزل الفروع
#
# الموارد البشرية متعزلة بالفرع زي المبيعات: موظف الفرع بيشوف موظفين فرعه وسلفهم وبس،
# والمالك/الأدمن بيشوف الكل أو الفرع اللي اختاره من الشريط فوق. والرابط المباشر بالرقم
# (إلغاء/تعديل سلفة فرع تاني) بيرجع ٤٠٤ — مش ٤٠٣، عشان مايأكّدش إن الرقم موجود أصلاً.


def _not_found(message: str):
    raise HTTPException(404, {"code": "not_found", "message": message})


def _seen_employee(db: Session, employee_id: int, current: CurrentUser) -> Employee:
    emp = db.scalar(branch_scope.scope(
        select(Employee).where(Employee.id == employee_id), Employee, current))
    if emp is None:
        _not_found("الموظف غير موجود.")
    return emp


def _advance_scope(stmt, current: CurrentUser):
    """فرع السلفة هو المختوم عليها، والقديمة اللي مالهاش فرع بتاخد فرع موظفها.

    السلف اللي اتصرفت قبل الختم `branch_id` بتاعها فاضي — بالقاعدة العامة كانت هتبان لكل
    الفروع، فسلفة موظف أكتوبر تظهر لمدير العلياء.
    """
    branch_id = branch_scope.visible_branch_id(current)
    stmt = stmt.join(Employee, Employee.id == EmployeeAdvance.employee_id)
    if branch_id is None:
        return stmt
    return stmt.where(or_(
        EmployeeAdvance.branch_id == branch_id,
        and_(EmployeeAdvance.branch_id.is_(None),
             or_(Employee.branch_id == branch_id, Employee.branch_id.is_(None)))))


def _seen_advance(db: Session, advance_id: int, current: CurrentUser) -> EmployeeAdvance:
    row = db.scalar(_advance_scope(
        select(EmployeeAdvance).where(EmployeeAdvance.id == advance_id), current))
    if row is None:
        _not_found("السلفة غير موجودة.")
    return row


def _check_treasury(db: Session, treasury_id: int | None, current: CurrentUser) -> None:
    """خزنة فرع تاني مش من حق موظف الفرع يصرف منها."""
    if treasury_id is None:
        return
    from src.models.treasury import Treasury

    t = db.get(Treasury, treasury_id)
    branch_id = branch_scope.visible_branch_id(current)
    if t is None or (branch_id is not None and t.branch_id not in (None, branch_id)):
        _not_found("الخزنة غير موجودة.")


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
        "treasury_id": a.treasury_id, "branch_id": a.branch_id,
        "cost_center_id": a.cost_center_id,
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
    current: CurrentUser = Depends(require_capability(CAP_SALARY_VIEW)),
    db: Session = Depends(get_db),
) -> list[dict]:
    stmt = _advance_scope(select(EmployeeAdvance), current).order_by(
        EmployeeAdvance.advance_date.desc(), EmployeeAdvance.id.desc())
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
    """بتتصرف من الخزنة وبتتقيد **أصل** — مدين سلف العاملين / دائن الخزنة.

    **الفرع بيتختم على السلفة**: المكتوب، وإلا فرع الموظف، وإلا فرع اللي بيصرف. من غيره
    كل السلف كانت `branch_id` فاضي فبتبان لكل الفروع، والقيد بينزل على خزنة مش خزنة الفرع.
    """
    emp = _seen_employee(db, body.employee_id, current)
    data = body.model_dump()
    visible = branch_scope.visible_branch_id(current)
    data["branch_id"] = body.branch_id or emp.branch_id or current.branch_id or visible
    if visible is not None and data["branch_id"] not in (None, visible):
        _not_found("الفرع غير موجود.")
    _check_treasury(db, body.treasury_id, current)
    try:
        row = advance_service.create_advance(db, actor_user_id=current.id, **data)
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
    _seen_advance(db, advance_id, current)
    try:
        row = advance_service.cancel_advance(
            db, advance_id=advance_id, actor_user_id=current.id)
    except (AdvanceError, LedgerError) as exc:
        _raise(exc)
    out = _advance_out(db, row)
    db.commit()
    return out


@router.put("/advances/{advance_id}")
def update_advance(
    advance_id: int,
    body: AdvanceUpdateIn,
    current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
    db: Session = Depends(get_db),
) -> dict:
    """تعديل سلفة لسه مااتخصمش منها قسط — نفس الرقم ونفس القيد (بيترحّل تاني)."""
    _seen_advance(db, advance_id, current)
    _check_treasury(db, body.treasury_id, current)
    try:
        row = advance_service.update_advance(
            db, advance_id=advance_id, actor_user_id=current.id, **body.model_dump())
    except (AdvanceError, LedgerError) as exc:
        _raise(exc)
    out = _advance_out(db, row)
    db.commit()
    return out


# ------------------------------------------------------------- ذمم وسلف الموظفين


@router.get("/employee-dues")
def employee_dues(
    q: str | None = Query(None, description="بحث بالاسم أو الكود"),
    branch_id: int | None = Query(None, description="فلتر فرع جوّه اللي مسموحلك تشوفه"),
    only_open: bool = Query(True, description="اللي عليهم حاجة بس"),
    include_orphans: bool = Query(True, description="حسابات ذمم مالهاش موظف"),
    current: CurrentUser = Depends(require_capability(CAP_HR_READ)),
    db: Session = Depends(get_db),
) -> dict:
    """صف لكل موظف: ذمته من الدفتر + سلفه المفتوحة = إجمالي اللي عليه.

    على `hr.read` زي «ذمم الموظفين» القديمة، بس **أرقام السلف لـ`salary.view` بس** — السلفة
    رقم باسم موظف بيتخصم من مرتبه، ومدير الفرع مالوش يشوف مرتبات. فمن غيرها أعمدة السلف
    بترجع فاضية و`advances_visible=false`، والشاشة بتخفيها.

    والعزل: موظف الفرع بيشوف فرعه بس؛ و`branch_id` من الشاشة فلتر **جوّه** ده، مش باب حواليه.
    """
    visible = branch_scope.visible_branch_id(current)
    with_adv = current.can(CAP_SALARY_VIEW)
    if branch_id is not None and visible is not None and branch_id != visible:
        return {"rows": [], "total_ledger": "0.00", "total_advances": "0.00",
                "total_due": "0.00", "unlinked_employees": 0, "advances_visible": with_adv}
    res = employee_dues_service.employee_dues(
        db, branch_id=branch_id if branch_id is not None else visible, q=q,
        only_open=only_open, include_orphans=include_orphans, with_advances=with_adv)
    rows = [vars(r) for r in res.rows]
    if branch_id is not None:
        # فلتر الشاشة دقيق: الموظف اللي مالوش فرع مايتحسبش على فرع بعينه.
        rows = [r for r in rows if r["branch_id"] == branch_id]
    return {
        "rows": rows,
        "total_ledger": str(sum((r["ledger_balance"] for r in rows), Decimal(0))),
        "total_advances": str(sum((r["advances_outstanding"] or 0 for r in rows), Decimal(0))),
        "total_due": str(sum((r["total_due"] for r in rows), Decimal(0))),
        "unlinked_employees": res.unlinked_employees,
        "advances_visible": with_adv,
    }


# ------------------------------------------------------------- الجزاءات


@router.get("/adjustments")
def list_adjustments(
    employee_id: int | None = Query(None),
    year: int | None = Query(None),
    month: int | None = Query(None),
    kind: AdjustmentKind | None = Query(None),
    current: CurrentUser = Depends(require_capability(CAP_SALARY_VIEW)),
    db: Session = Depends(get_db),
) -> list[dict]:
    # الجزاء مالوش فرع — فرعه فرع الموظف.
    stmt = branch_scope.scope(
        select(PayrollAdjustment).join(Employee, Employee.id == PayrollAdjustment.employee_id),
        Employee, current,
    ).order_by(
        PayrollAdjustment.year.desc(), PayrollAdjustment.month.desc(), PayrollAdjustment.id.desc())
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
    _seen_employee(db, body.employee_id, current)
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
    adj = db.get(PayrollAdjustment, adjustment_id)
    if adj is None:
        _not_found("الجزاء غير موجود.")
    _seen_employee(db, adj.employee_id, current)
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
