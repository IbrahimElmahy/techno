from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.auth import branch_scope
from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_SALES_READ, CAP_SETTINGS_WRITE, RoleName
from src.core.db import get_db
from src.core.money import to_money
from src.models.customer import Customer
from src.models.rep_efficiency import CustomerMonthlyCredit, RepCreditAllowance
from src.services import rep_efficiency_service as svc

router = APIRouter(tags=["rep-efficiency"], prefix="/rep-efficiency")


class SettingsIn(BaseModel):
    allowed_debt_pct: Decimal
    penalty_per_thousand: Decimal


class AmountIn(BaseModel):
    amount: Decimal | None = None


def _rep_scope(current: CurrentUser, rep_id: int | None) -> int | None:
    return current.id if current.role == RoleName.sales_rep else rep_id


@router.get("")
def efficiency_report(
    year: int = Query(default_factory=lambda: date.today().year),
    month: int = Query(default_factory=lambda: date.today().month, ge=1, le=12),
    rep_id: int | None = None,
    current: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
) -> dict:
    out = svc.report(db, year=year, month=month,
                     branch_id=branch_scope.visible_branch_id(current),
                     rep_id=_rep_scope(current, rep_id))
    db.commit()
    return out


@router.get("/settings")
def get_settings(
    current: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
) -> dict:
    s = svc.settings(db)
    db.commit()
    return dict(allowed_debt_pct=s.allowed_debt_pct, penalty_per_thousand=s.penalty_per_thousand)


@router.put("/settings")
def put_settings(
    body: SettingsIn,
    current: CurrentUser = Depends(require_capability(CAP_SETTINGS_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    if not (0 <= body.allowed_debt_pct <= 100) or body.penalty_per_thousand < 0:
        raise HTTPException(422, {"code": "validation", "message": "قيم غير صحيحة."})
    s = svc.settings(db)
    s.allowed_debt_pct = body.allowed_debt_pct
    s.penalty_per_thousand = to_money(body.penalty_per_thousand)
    db.commit()
    return dict(allowed_debt_pct=s.allowed_debt_pct, penalty_per_thousand=s.penalty_per_thousand)


@router.get("/reps/{rep_id}/customers")
def rep_customers(
    rep_id: int,
    current: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
) -> dict:
    rep_id = _rep_scope(current, rep_id) or rep_id
    allowance = db.get(RepCreditAllowance, rep_id)
    return dict(rep_user_id=rep_id,
                credit_allowance=allowance.amount if allowance else None,
                customers=svc.rep_customers(db, rep_id, branch_scope.visible_branch_id(current)))


@router.put("/reps/{rep_id}/credit")
def put_rep_credit(
    rep_id: int, body: AmountIn,
    current: CurrentUser = Depends(require_capability(CAP_SETTINGS_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    row = db.get(RepCreditAllowance, rep_id)
    if body.amount is None:
        if row is not None:
            db.delete(row)
    elif body.amount < 0:
        raise HTTPException(422, {"code": "validation", "message": "قيمة غير صحيحة."})
    elif row is None:
        db.add(RepCreditAllowance(rep_user_id=rep_id, amount=to_money(body.amount)))
    else:
        row.amount = to_money(body.amount)
    db.commit()
    return dict(rep_user_id=rep_id, amount=body.amount)


@router.put("/customers/{customer_id}/credit")
def put_customer_credit(
    customer_id: int, body: AmountIn,
    current: CurrentUser = Depends(require_capability(CAP_SETTINGS_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    if db.get(Customer, customer_id) is None:
        raise HTTPException(404, {"code": "not_found", "message": "العميل غير موجود."})
    row = db.get(CustomerMonthlyCredit, customer_id)
    if body.amount is None or body.amount == 0:
        if row is not None:
            db.delete(row)
    elif body.amount < 0:
        raise HTTPException(422, {"code": "validation", "message": "قيمة غير صحيحة."})
    elif row is None:
        db.add(CustomerMonthlyCredit(customer_id=customer_id, amount=to_money(body.amount)))
    else:
        row.amount = to_money(body.amount)
    db.commit()
    return dict(customer_id=customer_id, amount=body.amount)
