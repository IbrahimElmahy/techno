"""مسير الرواتب — الحساب والترحيل والصرف والعكس (HR-6)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_PAYROLL_POST, CAP_PAYROLL_READ, CAP_SALARY_VIEW
from src.core.db import get_db
from src.models.employee import Employee
from src.models.hr_payroll_run import (
    PayrollLine,
    PayrollLineDetail,
    PayrollRemittance,
    PayrollRun,
)
from src.services import payroll_service
from src.services.ledger_service import LedgerError
from src.services.payroll_service import PayrollError

router = APIRouter(tags=["payroll"], prefix="/hr/payroll")


def _raise(exc: Exception):
    text = str(exc)
    if isinstance(exc, LedgerError):
        raise HTTPException(409, {"code": "ledger_invalid", "message": text}) from exc
    if "غير موجود" in text:
        raise HTTPException(404, {"code": "not_found", "message": text}) from exc
    if "مرحّل بالفعل" in text or "اتصرف" in text:
        raise HTTPException(409, {"code": "duplicate", "message": text}) from exc
    raise HTTPException(422, {"code": "validation", "message": text}) from exc


class RunIn(BaseModel):
    year: int
    month: int
    branch_id: int | None = None


class PayIn(BaseModel):
    treasury_id: int | None = None
    pay_date: date | None = None


class RemitIn(BaseModel):
    kind: str
    amount: Decimal
    remit_date: date
    branch_id: int | None = None
    notes: str | None = None


def _run_out(db: Session, run: PayrollRun, *, with_lines: bool = False) -> dict:
    out = {
        "id": run.id, "document_number": run.document_number,
        "year": run.year, "month": run.month, "branch_id": run.branch_id,
        "status": run.status.value, "reversal_seq": run.reversal_seq,
        "earnings": str(run.earnings), "absence_deduction": str(run.absence_deduction),
        "overtime": str(run.overtime), "bonuses": str(run.bonuses),
        "penalties": str(run.penalties), "gross": str(run.gross),
        "insurance_employee": str(run.insurance_employee),
        "insurance_employer": str(run.insurance_employer),
        "tax": str(run.tax), "advances": str(run.advances),
        "other_deductions": str(run.other_deductions),
        "total_deductions": str(run.total_deductions), "net": str(run.net),
        "accrual_entry_id": run.accrual_entry_id,
        "reversal_entry_id": run.reversal_entry_id,
        "tax_version_id": run.tax_version_id,
        "insurance_version_id": run.insurance_version_id,
        "posted_at": run.posted_at,
    }
    lines = db.scalars(select(PayrollLine).where(PayrollLine.run_id == run.id)).all()
    out["employees"] = len(lines)
    # «موظفين من غير سجل حضور» — بيتعرض ولا بيتخبى، زي `lines_without_cost` في تقارير البيع.
    out["without_attendance"] = len([x for x in lines if not x.has_attendance])
    out["paid"] = len([x for x in lines if x.paid])
    if with_lines:
        names = {e.id: e.name for e in db.scalars(select(Employee)).all()}
        out["lines"] = [_line_out(db, x, names) for x in lines]
    return out


def _line_out(db: Session, line: PayrollLine, names: dict | None = None) -> dict:
    name = (names or {}).get(line.employee_id)
    if name is None:
        emp = db.get(Employee, line.employee_id)
        name = emp.name if emp else None
    return {
        "id": line.id, "employee_id": line.employee_id, "employee_name": name,
        "department_id": line.department_id, "job_title_id": line.job_title_id,
        "basic": str(line.basic), "allowances": str(line.allowances),
        "overtime_hours": str(line.overtime_hours),
        "overtime_amount": str(line.overtime_amount), "gross": str(line.gross),
        "days_worked": str(line.days_worked), "days_absent": str(line.days_absent),
        "late_minutes": line.late_minutes,
        "absence_deduction": str(line.absence_deduction),
        "penalty_amount": str(line.penalty_amount), "bonus_amount": str(line.bonus_amount),
        "insurance_base": str(line.insurance_base),
        "insurance_employee": str(line.insurance_employee),
        "insurance_employer": str(line.insurance_employer),
        "taxable_base": str(line.taxable_base), "tax_amount": str(line.tax_amount),
        "advance_deduction": str(line.advance_deduction),
        "other_deductions": str(line.other_deductions),
        "total_deductions": str(line.total_deductions), "net": str(line.net),
        "has_attendance": line.has_attendance, "paid": line.paid,
    }


# ------------------------------------------------------------- المسير


@router.get("/runs")
def list_runs(
    year: int | None = Query(None),
    _: CurrentUser = Depends(require_capability(CAP_PAYROLL_READ)),
    db: Session = Depends(get_db),
) -> list[dict]:
    """وجود المسير وحالته — من غير مبالغ باسم حد. الأرقام محتاجة `salary.view`."""
    stmt = select(PayrollRun).order_by(PayrollRun.year.desc(), PayrollRun.month.desc())
    if year:
        stmt = stmt.where(PayrollRun.year == year)
    return [{
        "id": r.id, "document_number": r.document_number, "year": r.year,
        "month": r.month, "branch_id": r.branch_id, "status": r.status.value,
        "posted_at": r.posted_at,
    } for r in db.scalars(stmt).all()]


@router.get("/runs/{run_id}")
def get_run(
    run_id: int,
    _: CurrentUser = Depends(require_capability(CAP_SALARY_VIEW)),
    db: Session = Depends(get_db),
) -> dict:
    run = db.get(PayrollRun, run_id)
    if run is None:
        raise HTTPException(404, {"code": "not_found", "message": "المسير غير موجود."})
    return _run_out(db, run, with_lines=True)


@router.post("/runs", status_code=status.HTTP_201_CREATED)
def compute_run(
    body: RunIn,
    current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
    db: Session = Depends(get_db),
) -> dict:
    """بيحسب مسودة الشهر — مابيلمسش الأستاذ، وينفع يتعاد براحتك."""
    try:
        run = payroll_service.compute_run(db, actor_user_id=current.id, **body.model_dump())
    except (PayrollError, LedgerError) as exc:
        _raise(exc)
    out = _run_out(db, run, with_lines=True)
    db.commit()
    return out


@router.post("/runs/{run_id}/post")
def post_run(
    run_id: int,
    current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
    db: Session = Depends(get_db),
) -> dict:
    """بيرحّل للأستاذ. ضغطة تانية بترجّع `skipped` مش خطأ."""
    try:
        result = payroll_service.post_run(db, run_id=run_id, actor_user_id=current.id)
    except (PayrollError, LedgerError) as exc:
        _raise(exc)
    db.commit()
    return result


@router.post("/runs/{run_id}/reverse")
def reverse_run(
    run_id: int,
    current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
    db: Session = Depends(get_db),
) -> dict:
    """بيعكس المسير ويفتح الشهر — المستند بيفضل بترقيمه."""
    try:
        result = payroll_service.reverse_run(db, run_id=run_id, actor_user_id=current.id)
    except (PayrollError, LedgerError) as exc:
        _raise(exc)
    db.commit()
    return result


@router.post("/runs/{run_id}/pay")
def pay_run(
    run_id: int,
    body: PayIn,
    current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
    db: Session = Depends(get_db),
) -> dict:
    """صرف المرتبات — مدين مرتبات مستحقة / دائن الخزنة."""
    try:
        result = payroll_service.pay_run(
            db, run_id=run_id, actor_user_id=current.id, **body.model_dump())
    except (PayrollError, LedgerError) as exc:
        _raise(exc)
    db.commit()
    return result


@router.get("/runs/{run_id}/payslip/{employee_id}")
def payslip(
    run_id: int,
    employee_id: int,
    _: CurrentUser = Depends(require_capability(CAP_SALARY_VIEW)),
    db: Session = Depends(get_db),
) -> dict:
    """قسيمة الراتب — بند بند من `payroll_line_detail`."""
    line = db.scalar(select(PayrollLine).where(
        PayrollLine.run_id == run_id, PayrollLine.employee_id == employee_id))
    if line is None:
        raise HTTPException(404, {"code": "not_found", "message": "مافيش سطر للموظف ده."})
    run = db.get(PayrollRun, run_id)
    details = db.scalars(select(PayrollLineDetail).where(
        PayrollLineDetail.line_id == line.id).order_by(PayrollLineDetail.id)).all()
    return {
        "run": {"document_number": run.document_number, "year": run.year,
                "month": run.month, "status": run.status.value},
        "line": _line_out(db, line),
        "details": [{
            "source": d.source.value, "label": d.label, "kind": d.kind.value,
            "quantity": str(d.quantity) if d.quantity is not None else None,
            "amount": str(d.amount), "ref_id": d.ref_id,
        } for d in details],
    }


# ------------------------------------------------------------- السداد


@router.get("/remittances")
def list_remittances(
    _: CurrentUser = Depends(require_capability(CAP_PAYROLL_READ)),
    db: Session = Depends(get_db),
) -> list[dict]:
    rows = db.scalars(
        select(PayrollRemittance).order_by(PayrollRemittance.remit_date.desc())).all()
    return [{
        "id": r.id, "document_number": r.document_number, "kind": r.kind,
        "amount": str(r.amount), "remit_date": r.remit_date, "notes": r.notes,
        "ledger_entry_id": r.ledger_entry_id,
    } for r in rows]


@router.post("/remittances", status_code=status.HTTP_201_CREATED)
def create_remittance(
    body: RemitIn,
    current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
    db: Session = Depends(get_db),
) -> dict:
    """سداد التأمينات أو الضريبة — من غيره الالتزام بيكبر للأبد."""
    try:
        row = payroll_service.remit(db, actor_user_id=current.id, **body.model_dump())
    except (PayrollError, LedgerError) as exc:
        _raise(exc)
    out = {"id": row.id, "document_number": row.document_number, "kind": row.kind,
           "amount": str(row.amount), "ledger_entry_id": row.ledger_entry_id}
    db.commit()
    return out
