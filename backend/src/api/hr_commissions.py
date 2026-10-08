"""إعدادات العمولات ومعاينة الشهر — `/hr/commissions/...`.

كل اللي هنا مبالغ أو نسب باسم موظف، فالقراية على `salary.view` (مش `hr.read`: مدير الفرع
اللي بيعتمد الحضور مالوش يشوف عمولة زمايله) والتعديل على `payroll.post` كمان.

الفرع: موظف الفرع بيشتغل على فرعه بس مهما بعت؛ اللي فوق الفروع بيختار الفرع (أو الفرع
المختار من الشريط فوق). الحساب نفسه في `services/hr_commission_service.py`.
"""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.auth import branch_scope
from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_PAYROLL_POST, CAP_SALARY_VIEW
from src.core.db import get_db
from src.services import hr_commission_service as svc
from src.services.hr_commission_service import CommissionSetupError

router = APIRouter(tags=["hr-commissions"], prefix="/hr/commissions")


def _writer(current: CurrentUser = Depends(require_capability(CAP_SALARY_VIEW))) -> CurrentUser:
    """التعديل محتاج الاتنين: يشوف المبالغ، ويرحّل المرتبات."""
    if not current.can(CAP_PAYROLL_POST):
        raise HTTPException(status.HTTP_403_FORBIDDEN, {
            "code": "forbidden", "message": "تعديل إعدادات العمولات لمحاسب المرتبات بس."})
    return current


def _branch(current: CurrentUser, branch_id: int | None) -> int:
    if not branch_scope.sees_all_branches(current):
        if branch_id is not None and branch_id != current.branch_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, {
                "code": "forbidden", "message": "عمولات فرعك بس."})
        return int(current.branch_id)
    bid = branch_id or branch_scope.visible_branch_id(current)
    if bid is None:
        raise HTTPException(422, {"code": "validation", "message": "اختار الفرع الأول."})
    return int(bid)


def _raise(exc: CommissionSetupError):
    text = str(exc)
    if "غير موجود" in text:
        raise HTTPException(404, {"code": "not_found", "message": text}) from exc
    raise HTTPException(422, {"code": "validation", "message": text}) from exc


# ----------------------------------------------------------------- schemas

class SettingsIn(BaseModel):
    point_value: Decimal | None = None
    points_per_coupon: int | None = None
    factor_divisor: Decimal | None = None
    absence_divisor: Decimal | None = None
    penalty_sales_pct: Decimal | None = None
    penalty_per_thousand: Decimal | None = None
    attribute_by_customer_rep: bool | None = None
    pay_coupon_commission: bool | None = None
    apply_min_inspections: bool | None = None


class MemberIn(BaseModel):
    employee_id: int
    exempt_25: bool = False


class TeamIn(BaseModel):
    name: str
    rate_poly: Decimal = Decimal("0")
    rate_white: Decimal = Decimal("0")
    rate_other: Decimal = Decimal("0")
    split_equally: bool = True
    penalty_enabled: bool = False
    credit_limit: Decimal = Decimal("0")
    active: bool = True
    sort_order: int = 0
    notes: str | None = None
    users: list[int] = []
    members: list[MemberIn] = []


class SupervisorIn(BaseModel):
    employee_id: int
    label: str | None = None
    rate_poly: Decimal = Decimal("0")
    rate_white: Decimal = Decimal("0")
    rate_other: Decimal = Decimal("0")
    penalty_rate: Decimal = Decimal("0")
    period_offset: int = 0
    deduct_absence: bool = True
    active: bool = True
    sort_order: int = 0
    notes: str | None = None
    teams: list[int] = []


class TechnicianIn(BaseModel):
    employee_id: int
    factor: Decimal = Decimal("0")
    min_inspections: int = 0
    inspection_rate: Decimal = Decimal("0")
    plumber_rate: Decimal = Decimal("0")
    scope: str = "own"
    active: bool = True
    sort_order: int = 0
    notes: str | None = None


class ManualIn(BaseModel):
    year: int
    month: int
    poly: Decimal = Decimal("0")
    white: Decimal = Decimal("0")
    other: Decimal = Decimal("0")
    notes: str | None = None


# ----------------------------------------------------------------- الإعدادات

@router.get("/setup")
def get_setup(
    branch_id: int | None = Query(None),
    current: CurrentUser = Depends(require_capability(CAP_SALARY_VIEW)),
    db: Session = Depends(get_db),
) -> dict:
    """إعدادات الفرع كلها وقوايم الاختيار."""
    bid = _branch(current, branch_id)
    try:
        return svc.setup_payload(db, bid)
    except CommissionSetupError as exc:
        _raise(exc)


@router.put("/settings")
def put_settings(body: SettingsIn, branch_id: int | None = Query(None),
                 current: CurrentUser = Depends(_writer), db: Session = Depends(get_db)) -> dict:
    bid = _branch(current, branch_id)
    try:
        row = svc.save_settings(db, branch_id=bid, data=body.model_dump(),
                                actor_user_id=current.id)
    except CommissionSetupError as exc:
        db.rollback()
        _raise(exc)
    db.commit()
    return svc.settings_out(row)


def _save(fn, db: Session, current: CurrentUser, branch_id: int | None, **kw):
    bid = _branch(current, branch_id)
    try:
        row = fn(db, branch_id=bid, actor_user_id=current.id, **kw)
    except CommissionSetupError as exc:
        db.rollback()
        _raise(exc)
    db.commit()
    return row


@router.post("/teams", status_code=status.HTTP_201_CREATED)
def create_team(body: TeamIn, branch_id: int | None = Query(None),
                current: CurrentUser = Depends(_writer), db: Session = Depends(get_db)) -> dict:
    row = _save(svc.save_team, db, current, branch_id, data=body.model_dump())
    return svc.team_out(db, row)


@router.put("/teams/{team_id}")
def update_team(team_id: int, body: TeamIn, branch_id: int | None = Query(None),
                current: CurrentUser = Depends(_writer), db: Session = Depends(get_db)) -> dict:
    row = _save(svc.save_team, db, current, branch_id, data=body.model_dump(), team_id=team_id)
    return svc.team_out(db, row)


@router.delete("/teams/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_team(team_id: int, branch_id: int | None = Query(None),
                current: CurrentUser = Depends(_writer), db: Session = Depends(get_db)) -> None:
    _save(svc.delete_team, db, current, branch_id, team_id=team_id)


@router.put("/teams/{team_id}/manual")
def put_manual(team_id: int, body: ManualIn, branch_id: int | None = Query(None),
               current: CurrentUser = Depends(_writer), db: Session = Depends(get_db)) -> dict:
    """تحصيل الشهر من بره النظام — أصفار من غير ملاحظة = شيله."""
    _save(svc.set_manual_collection, db, current, branch_id, team_id=team_id, year=body.year,
          month=body.month, poly=body.poly, white=body.white, other=body.other,
          notes=body.notes)
    return {"ok": True}


@router.post("/supervisors", status_code=status.HTTP_201_CREATED)
def create_supervisor(body: SupervisorIn, branch_id: int | None = Query(None),
                      current: CurrentUser = Depends(_writer),
                      db: Session = Depends(get_db)) -> dict:
    row = _save(svc.save_supervisor, db, current, branch_id, data=body.model_dump())
    return svc.supervisor_out(db, row)


@router.put("/supervisors/{supervisor_id}")
def update_supervisor(supervisor_id: int, body: SupervisorIn, branch_id: int | None = Query(None),
                      current: CurrentUser = Depends(_writer),
                      db: Session = Depends(get_db)) -> dict:
    row = _save(svc.save_supervisor, db, current, branch_id, data=body.model_dump(),
                supervisor_id=supervisor_id)
    return svc.supervisor_out(db, row)


@router.delete("/supervisors/{supervisor_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_supervisor(supervisor_id: int, branch_id: int | None = Query(None),
                      current: CurrentUser = Depends(_writer),
                      db: Session = Depends(get_db)) -> None:
    _save(svc.delete_supervisor, db, current, branch_id, supervisor_id=supervisor_id)


@router.post("/technicians", status_code=status.HTTP_201_CREATED)
def create_technician(body: TechnicianIn, branch_id: int | None = Query(None),
                      current: CurrentUser = Depends(_writer),
                      db: Session = Depends(get_db)) -> dict:
    row = _save(svc.save_technician, db, current, branch_id, data=body.model_dump())
    return svc.technician_out(db, row)


@router.put("/technicians/{technician_id}")
def update_technician(technician_id: int, body: TechnicianIn,
                      branch_id: int | None = Query(None),
                      current: CurrentUser = Depends(_writer),
                      db: Session = Depends(get_db)) -> dict:
    row = _save(svc.save_technician, db, current, branch_id, data=body.model_dump(),
                technician_id=technician_id)
    return svc.technician_out(db, row)


@router.delete("/technicians/{technician_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_technician(technician_id: int, branch_id: int | None = Query(None),
                      current: CurrentUser = Depends(_writer),
                      db: Session = Depends(get_db)) -> None:
    _save(svc.delete_technician, db, current, branch_id, technician_id=technician_id)


# ----------------------------------------------------------------- معاينة الشهر

@router.get("/compute")
def compute(
    year: int = Query(...),
    month: int = Query(..., ge=1, le=12),
    branch_id: int | None = Query(None),
    current: CurrentUser = Depends(require_capability(CAP_SALARY_VIEW)),
    db: Session = Depends(get_db),
) -> dict:
    """عمولات الشهر: صف لكل موظف + تفاصيل كل سيارة ومشرف وفني (قراية بس)."""
    bid = _branch(current, branch_id)
    try:
        result = svc.compute(db, branch_id=bid, year=year, month=month)
    except CommissionSetupError as exc:
        _raise(exc)
    details = result.pop("details")
    employees = [{"employee_id": eid} | row for eid, row in result.items()]
    employees.sort(key=lambda r: (-(r["earnings"] - r["deductions"]), r["name"]))
    return {"employees": employees, "details": details}
