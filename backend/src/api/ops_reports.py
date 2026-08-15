"""تقارير التشغيل والتحليل — محرك واحد بأسماء كتير (٨)."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, get_current_user, require_capability
from src.auth.rbac import (
    CAP_ACCOUNTING_TRIAL_BALANCE_READ,
    CAP_INSPECTION_READ,
    CAP_LOYALTY_READ,
    CAP_SALES_READ,
    CAP_VOUCHER_READ,
    role_has_capability,
)
from src.core.db import get_db
from src.lib import analysis_reports, ops_reports
from src.lib.analysis_reports import AnalysisReportError
from src.lib.ops_reports import OpsReportError

router = APIRouter(tags=["ops-reports"], prefix="/reports")

# كل موضوع بيتقفل على صلاحية الموديول اللي بيقرا منه، مش على صلاحية «تقارير» عامة.
#
# One endpoint answering seven subjects must not become a way around seven separate gates. A
# capability called `reports.read` would be exactly that: whoever holds it reads the cheque
# register, the loyalty ledger and every customer's inspection history, whatever their job. So the
# check happens per request against the subject actually asked for.
_SUBJECT_CAPABILITY = {
    "points": CAP_LOYALTY_READ,
    "coupons": CAP_LOYALTY_READ,
    "coupon_receipts": CAP_LOYALTY_READ,
    "inspections": CAP_INSPECTION_READ,
    "cheques": CAP_VOUCHER_READ,
    "orders": CAP_SALES_READ,
    "reservations": CAP_SALES_READ,
}


def _require_subject(current: CurrentUser, subject: str) -> None:
    needed = _SUBJECT_CAPABILITY.get(subject)
    if needed is None:
        raise HTTPException(422, {"code": "report_invalid",
                                  "message": f"موضوع مش معروف: {subject}"})
    if not role_has_capability(current.role, needed):
        raise HTTPException(403, {"code": "forbidden",
                                  "message": "مالكش صلاحية على التقرير ده."})


@router.get("/ops")
def ops_report(
    subject: str = Query("inspections"),
    level: str = Query("detail"),
    group_by: str = Query("none"),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    customer_id: int | None = Query(None),
    rep_id: int | None = Query(None),
    status: str | None = Query(None),
    kind: str | None = Query(None),
    due_within_days: int | None = Query(None),
    only_open: bool = Query(False),
    limit: int | None = Query(None),
    offset: int = Query(0),
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """النقاط والكوبونات والمعاينات والشيكات والطلبات والحجوزات — كلهم من دالة واحدة."""
    _require_subject(current, subject)
    try:
        return ops_reports.ops(
            db, subject=subject, level=level, group_by=group_by,
            date_from=date_from, date_to=date_to, customer_id=customer_id,
            rep_id=rep_id, status=status, kind=kind,
            due_within_days=due_within_days, only_open=only_open,
            limit=limit, offset=offset,
        )
    except OpsReportError as exc:
        raise HTTPException(422, {"code": "report_invalid", "message": str(exc)}) from exc


@router.get("/ops/top-customers")
def top_customers(
    metric: str = Query("points"),
    limit: int = Query(20, ge=1, le=200),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    _require_subject(current, "points" if metric == "points" else "coupons")
    try:
        return ops_reports.top_customers(
            db, metric=metric, limit=limit, date_from=date_from, date_to=date_to)
    except OpsReportError as exc:
        raise HTTPException(422, {"code": "report_invalid", "message": str(exc)}) from exc


@router.get("/profitability")
def profitability(
    dimension: str = Query("cost_center"),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    include_unassigned: bool = Query(True),
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_TRIAL_BALANCE_READ)),
    db: Session = Depends(get_db),
) -> dict:
    """أرباح وخسائر لكل مركز تكلفة أو لكل فرع — بتتقرا من الدفتر مش من المستندات."""
    try:
        return analysis_reports.profitability(
            db, dimension=dimension, date_from=date_from, date_to=date_to,
            include_unassigned=include_unassigned)
    except AnalysisReportError as exc:
        raise HTTPException(422, {"code": "report_invalid", "message": str(exc)}) from exc


@router.get("/profitability/breakdown")
def profitability_breakdown(
    dimension: str = Query("cost_center"),
    key: int | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_TRIAL_BALANCE_READ)),
    db: Session = Depends(get_db),
) -> dict:
    """«الرقم ده جه منين» — تفصيل المركز الواحد بالحساب."""
    try:
        return analysis_reports.account_breakdown(
            db, dimension=dimension, key=key, date_from=date_from, date_to=date_to)
    except AnalysisReportError as exc:
        raise HTTPException(422, {"code": "report_invalid", "message": str(exc)}) from exc
