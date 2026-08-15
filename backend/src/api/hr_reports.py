"""تقارير الموارد البشرية — محرك واحد بأسماء كتير (HR-7)."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_HR_READ, CAP_SALARY_VIEW
from src.core.db import get_db
from src.lib import hr_reports
from src.lib.hr_reports import HrReportError

router = APIRouter(tags=["hr-reports"], prefix="/hr/reports")

# المواضيع اللي بترجّع مبالغ باسم موظف — محتاجة `salary.view` مش `hr.read`.
_MONEY_SUBJECTS = {"payroll", "cost", "advance", "adjustment"}


@router.get("")
def hr_report(
    subject: str = Query("payroll"),
    level: str = Query("detail"),
    group_by: str = Query("none"),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    year: int | None = Query(None),
    month: int | None = Query(None),
    employee_id: int | None = Query(None),
    department_id: int | None = Query(None),
    branch_id: int | None = Query(None),
    status: str | None = Query(None),
    include_drafts: bool = Query(False),
    limit: int | None = Query(None),
    offset: int = Query(0),
    current: CurrentUser = Depends(require_capability(CAP_HR_READ)),
    db: Session = Depends(get_db),
) -> dict:
    """`subject` × `level` × `group_by` — أربعين تقرير من دالة واحدة.

    The money subjects are gated a second time inside rather than on the route: one endpoint that
    answers both «مين غايب» and «مين بياخد كام» has to check per request, and `hr.read` is the
    right bar for the first and much too low for the second.
    """
    if subject in _MONEY_SUBJECTS:
        from src.auth.rbac import role_has_capability

        if not role_has_capability(current.role, CAP_SALARY_VIEW):
            raise HTTPException(403, {"code": "forbidden",
                                      "message": "التقرير ده فيه مبالغ باسم موظف."})
    try:
        return hr_reports.hr(
            db, subject=subject, level=level, group_by=group_by,
            date_from=date_from, date_to=date_to, year=year, month=month,
            employee_id=employee_id, department_id=department_id, branch_id=branch_id,
            status=status, include_drafts=include_drafts, limit=limit, offset=offset,
        )
    except HrReportError as exc:
        raise HTTPException(422, {"code": "report_invalid", "message": str(exc)}) from exc


@router.get("/leave-balances")
def leave_balances(
    year: int = Query(...),
    employee_id: int | None = Query(None),
    _: CurrentUser = Depends(require_capability(CAP_HR_READ)),
    db: Session = Depends(get_db),
) -> dict:
    """أرصدة الأجازات — أيام مش فلوس، فـ`hr.read` كفاية."""
    return hr_reports.leave_balances(db, year=year, employee_id=employee_id)
