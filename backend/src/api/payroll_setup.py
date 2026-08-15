"""هيكل الرواتب والشرايح (HR-4).

`CAP_SALARY_VIEW` gates everything that returns an amount against a named employee. It does NOT end
in `.read`, deliberately — see the block in `auth/rbac.py`. `hr.read` is not enough here: a branch
manager who approves attendance has no business reading his colleagues' salaries.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_HR_READ, CAP_PAYROLL_POST, CAP_SALARY_VIEW
from src.core.db import get_db
from src.models.employee import Employee
from src.models.hr_payroll import (
    ComponentCalc,
    ComponentKind,
    EmployeeSalary,
    PayMethod,
    PayrollSchemeVersion,
    SalaryComponent,
    SchemeKind,
)
from src.services import payroll_setup_service as setup
from src.services.payroll_setup_service import PayrollSetupError

router = APIRouter(tags=["payroll-setup"], prefix="/hr/payroll")


def _raise(exc: PayrollSetupError):
    text = str(exc)
    if "غير موجود" in text or "غير موجودة" in text:
        raise HTTPException(404, {"code": "not_found", "message": text}) from exc
    if "استُخدمت في مرتب مرحّل" in text:
        raise HTTPException(409, {"code": "locked", "message": text}) from exc
    raise HTTPException(422, {"code": "validation", "message": text}) from exc


# ----------------------------------------------------------------- schemas


class ComponentIn(BaseModel):
    name: str
    kind: ComponentKind
    code: str | None = None
    calc: ComponentCalc = ComponentCalc.fixed
    taxable: bool = True
    insurable: bool = False
    account_id: int | None = None
    sort_order: int = 0
    notes: str | None = None


class ComponentOut(BaseModel):
    id: int
    code: str
    name: str
    kind: ComponentKind
    calc: ComponentCalc
    taxable: bool
    insurable: bool
    account_id: int | None
    active: bool


class SalaryLineIn(BaseModel):
    component_id: int
    amount: Decimal = Decimal("0")
    pct: Decimal | None = None
    notes: str | None = None


class SalaryIn(BaseModel):
    employee_id: int
    effective_from: date
    basic: Decimal
    insurance_base: Decimal | None = None
    payment_method: PayMethod | None = None
    bank_name: str | None = None
    bank_account: str | None = None
    lines: list[SalaryLineIn] | None = None
    notes: str | None = None


class BracketIn(BaseModel):
    from_amount: Decimal = Decimal("0")
    to_amount: Decimal | None = None
    rate_pct: Decimal = Decimal("0")
    fixed_amount: Decimal = Decimal("0")


class VersionIn(BaseModel):
    scheme: SchemeKind
    name: str
    effective_from: date
    brackets: list[BracketIn] | None = None
    annual_exemption: Decimal | None = None
    annualise: bool = True
    employee_pct: Decimal | None = None
    employer_pct: Decimal | None = None
    min_base: Decimal | None = None
    max_base: Decimal | None = None
    notes: str | None = None


class VersionPatch(BaseModel):
    name: str | None = None
    effective_to: date | None = None
    brackets: list[BracketIn] | None = None
    annual_exemption: Decimal | None = None
    employee_pct: Decimal | None = None
    employer_pct: Decimal | None = None
    min_base: Decimal | None = None
    max_base: Decimal | None = None
    notes: str | None = None


class SettingsIn(BaseModel):
    days_per_month: int | None = None
    hours_per_day: Decimal | None = None
    overtime_normal_pct: Decimal | None = None
    overtime_holiday_pct: Decimal | None = None
    include_commission: bool | None = None
    late_grace_minutes: int | None = None


def _version_out(db: Session, v: PayrollSchemeVersion) -> dict:
    return {
        "id": v.id, "scheme": v.scheme.value, "name": v.name,
        "effective_from": v.effective_from, "effective_to": v.effective_to,
        "annual_exemption": v.annual_exemption, "annualise": v.annualise,
        "employee_pct": v.employee_pct, "employer_pct": v.employer_pct,
        "min_base": v.min_base, "max_base": v.max_base,
        "locked": v.locked, "active": v.active, "notes": v.notes,
        "brackets": [
            {"sequence": i + 1, "from_amount": str(b.from_amount),
             "to_amount": str(b.to_amount) if b.to_amount is not None else None,
             "rate_pct": str(b.rate_pct), "fixed_amount": str(b.fixed_amount)}
            for i, b in enumerate(setup.brackets_of(db, v.id))
        ],
    }


# ------------------------------------------------------------- البنود


@router.get("/components", response_model=list[ComponentOut])
def list_components(
    _: CurrentUser = Depends(require_capability(CAP_HR_READ)),
    db: Session = Depends(get_db),
) -> list[ComponentOut]:
    """أسماء البنود مش مبالغ — دي بيانات أساسية، مش مرتب حد."""
    return [ComponentOut.model_validate(c, from_attributes=True)
            for c in db.scalars(select(SalaryComponent).order_by(SalaryComponent.code)).all()]


@router.post("/components", response_model=ComponentOut, status_code=status.HTTP_201_CREATED)
def create_component(
    body: ComponentIn,
    current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
    db: Session = Depends(get_db),
) -> ComponentOut:
    try:
        row = setup.create_component(db, actor_user_id=current.id, **body.model_dump())
    except PayrollSetupError as exc:
        _raise(exc)
    out = ComponentOut.model_validate(row, from_attributes=True)
    db.commit()
    return out


@router.delete("/components/{component_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_component(
    component_id: int,
    _: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
    db: Session = Depends(get_db),
) -> None:
    row = db.get(SalaryComponent, component_id)
    if row is None:
        raise HTTPException(404, {"code": "not_found", "message": "البند غير موجود."})
    row.active = False
    db.commit()


# ------------------------------------------------------------- هيكل الراتب


@router.get("/salaries/{employee_id}")
def employee_salary(
    employee_id: int,
    on: date | None = Query(None),
    _: CurrentUser = Depends(require_capability(CAP_SALARY_VIEW)),
    db: Session = Depends(get_db),
) -> dict:
    """هيكل الراتب الساري في يوم — ومعاه كل النسخ عشان الزيادات تتقري."""
    if db.get(Employee, employee_id) is None:
        raise HTTPException(404, {"code": "not_found", "message": "الموظف غير موجود."})
    current = setup.salary_on(db, employee_id, on or date.today())
    history = db.scalars(
        select(EmployeeSalary)
        .where(EmployeeSalary.employee_id == employee_id)
        .order_by(EmployeeSalary.effective_from.desc())
    ).all()
    return {
        "employee_id": employee_id,
        "current": (setup.salary_breakdown(db, current) | {
            "id": current.id, "effective_from": str(current.effective_from),
            "payment_method": current.payment_method.value,
        }) if current else None,
        "history": [
            {"id": h.id, "effective_from": str(h.effective_from), "basic": str(h.basic)}
            for h in history
        ],
    }


@router.post("/salaries", status_code=status.HTTP_201_CREATED)
def set_salary(
    body: SalaryIn,
    current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
    db: Session = Depends(get_db),
) -> dict:
    """الزيادة صف جديد بتاريخ سريان جديد — مش تعديل للقديم، عشان قسيمة الشهر اللي فات
    تفضل زي ما كانت."""
    payload = body.model_dump()
    payload["lines"] = [line for line in (payload.get("lines") or [])] \
        if body.lines is not None else None
    try:
        row = setup.set_salary(db, actor_user_id=current.id, **payload)
    except PayrollSetupError as exc:
        _raise(exc)
    out = setup.salary_breakdown(db, row) | {
        "id": row.id, "effective_from": str(row.effective_from)}
    db.commit()
    return out


# ------------------------------------------------------------- الشرايح


@router.get("/schemes")
def list_versions(
    scheme: SchemeKind | None = Query(None),
    _: CurrentUser = Depends(require_capability(CAP_HR_READ)),
    db: Session = Depends(get_db),
) -> list[dict]:
    stmt = select(PayrollSchemeVersion).order_by(
        PayrollSchemeVersion.scheme, PayrollSchemeVersion.effective_from.desc())
    if scheme:
        stmt = stmt.where(PayrollSchemeVersion.scheme == scheme)
    return [_version_out(db, v) for v in db.scalars(stmt).all()]


@router.post("/schemes", status_code=status.HTTP_201_CREATED)
def create_version(
    body: VersionIn,
    current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
    db: Session = Depends(get_db),
) -> dict:
    payload = body.model_dump()
    payload["brackets"] = [b for b in (payload.get("brackets") or [])]
    try:
        row = setup.create_version(db, actor_user_id=current.id, **payload)
    except PayrollSetupError as exc:
        _raise(exc)
    out = _version_out(db, row)
    db.commit()
    return out


@router.patch("/schemes/{version_id}")
def update_version(
    version_id: int,
    body: VersionPatch,
    current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
    db: Session = Depends(get_db),
) -> dict:
    payload = body.model_dump(exclude_unset=True)
    brackets = payload.pop("brackets", None)
    try:
        row = setup.update_version(
            db, version_id=version_id, actor_user_id=current.id,
            brackets=brackets, **payload)
    except PayrollSetupError as exc:
        _raise(exc)
    out = _version_out(db, row)
    db.commit()
    return out


@router.get("/schemes/effective")
def effective_version(
    scheme: SchemeKind = Query(...),
    on: date = Query(...),
    _: CurrentUser = Depends(require_capability(CAP_HR_READ)),
    db: Session = Depends(get_db),
) -> dict | None:
    """الإصدار الساري في تاريخ — بيجاوب «الشهر ده هيتحسب بأنهي شرايح» قبل ما يترحّل."""
    row = setup.version_on(db, scheme, on)
    return _version_out(db, row) if row else None


# ------------------------------------------------------------- الإعدادات


def _settings_out(row) -> dict:
    return {
        "days_per_month": row.days_per_month, "hours_per_day": str(row.hours_per_day),
        "overtime_normal_pct": str(row.overtime_normal_pct),
        "overtime_holiday_pct": str(row.overtime_holiday_pct),
        "absence_basis": row.absence_basis.value, "late_policy": row.late_policy.value,
        "late_grace_minutes": row.late_grace_minutes,
        "include_commission": row.include_commission,
    }


@router.get("/settings")
def read_settings(
    _: CurrentUser = Depends(require_capability(CAP_HR_READ)),
    db: Session = Depends(get_db),
) -> dict:
    """أول قراية بتعمل الصف بالافتراضيات — فالشاشة بتفتح على قيم، مش على فاضي."""
    out = _settings_out(setup.settings(db))
    db.commit()
    return out


@router.patch("/settings")
def update_settings(
    body: SettingsIn,
    current: CurrentUser = Depends(require_capability(CAP_PAYROLL_POST)),
    db: Session = Depends(get_db),
) -> dict:
    row = setup.update_settings(
        db, actor_user_id=current.id, **body.model_dump(exclude_unset=True))
    out = _settings_out(row)
    db.commit()
    return out
