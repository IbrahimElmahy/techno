"""VAT return + rep commissions router — 021-tax-commissions."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_VOUCHER_READ, CAP_VOUCHER_WRITE
from src.core.db import get_db
from src.models.role import RoleName
from src.services import commission_service, tax_service
from src.services.commission_service import CommissionBasis, CommissionError

router = APIRouter(tags=["tax-commissions"])


class VatReturnOut(BaseModel):
    date_from: date | None
    date_to: date | None
    rate_pct: Decimal
    output_tax: Decimal
    input_tax: Decimal
    net_payable: Decimal


class CommissionRuleIn(BaseModel):
    rep_user_id: int | None = None  # None = القاعدة الافتراضية لكل المناديب
    rate_pct: Decimal
    basis: CommissionBasis = CommissionBasis.collection


class CommissionRuleOut(BaseModel):
    id: int
    rep_user_id: int | None
    rate_pct: Decimal
    basis: str


class CommissionRowOut(BaseModel):
    rep_user_id: int
    rep_name: str
    basis: CommissionBasis
    rate_pct: Decimal
    base_amount: Decimal
    commission: Decimal


@router.get("/reports/vat-return", response_model=VatReturnOut)
def vat_return(
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    _: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> VatReturnOut:
    """الإقرار الضريبي — ضريبة المبيعات ناقص ضريبة المشتريات."""
    r = tax_service.vat_return(db, date_from=date_from, date_to=date_to)
    return VatReturnOut(**r)


@router.get("/commission-rules", response_model=list[CommissionRuleOut])
def list_commission_rules(
    _: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> list[CommissionRuleOut]:
    return [CommissionRuleOut(id=r.id, rep_user_id=r.rep_user_id,
                              rate_pct=Decimal(str(r.rate_pct)), basis=r.basis)
            for r in commission_service.list_rules(db)]


@router.put("/commission-rules", response_model=CommissionRuleOut)
def set_commission_rule(
    body: CommissionRuleIn,
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_WRITE)),
    db: Session = Depends(get_db),
) -> CommissionRuleOut:
    """نسبة عمولة لمندوب (أو الافتراضية للكل) — على المبيعات أو على التحصيل."""
    if current.role == RoleName.sales_rep:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            {"code": "forbidden", "message": "تحديد العمولات من الإدارة فقط."})
    try:
        rule = commission_service.set_rule(
            db, rate_pct=body.rate_pct, rep_user_id=body.rep_user_id, basis=body.basis,
            actor_user_id=current.id)
    except CommissionError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "commission_invalid", "message": str(exc)})
    db.commit()
    return CommissionRuleOut(id=rule.id, rep_user_id=rule.rep_user_id,
                             rate_pct=Decimal(str(rule.rate_pct)), basis=rule.basis)


@router.get("/reports/commissions", response_model=list[CommissionRowOut])
def commissions_report(
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    rep_id: int | None = Query(default=None),
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> list[CommissionRowOut]:
    """كشف عمولات المناديب — المندوب يرى عمولته هو فقط."""
    scope = current.id if current.role == RoleName.sales_rep else rep_id
    rows = commission_service.compute(db, date_from=date_from, date_to=date_to,
                                      rep_user_id=scope)
    return [CommissionRowOut(
        rep_user_id=r.rep_user_id, rep_name=r.rep_name, basis=r.basis,
        rate_pct=r.rate_pct, base_amount=r.base_amount, commission=r.commission)
        for r in rows]
