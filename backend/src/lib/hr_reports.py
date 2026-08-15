"""محرك تقارير الموارد البشرية — واحد بيخدم أربعين اسم (HR-7).

Same shape as `lib/trade_reports.py`, and for the same reason: «كشف حضور تفصيلي» and «ملخص الحضور
بالقسم» and «غياب الشهر بالفرع» are not three reports, they are one set of rows crossed with a
grain and a grouping. Written as forty queries they drift apart the first time an absence rule
changes; written once they cannot.

`_collect` flattens every subject into ONE row shape — `{employee_id, department_id, branch_id,
job_title_id, period, label, quantity, amount, …}` — so the grouping and totalling code below it is
written exactly once.

**الترقيم في السيرفر.** Attendance is employees × days: two hundred people over a year is 73,000
rows, and returning all of them kills the tab. `limit`/`offset` with `truncated` on the envelope,
and — the trap — **the totals are computed over the WHOLE filtered set, never over the page**. A
total that describes the visible page is worse than no total, because it looks like an answer.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money, to_qty
from src.models.employee import Employee, JobTitle
from src.models.hr_advance import EmployeeAdvance, PayrollAdjustment
from src.models.hr_attendance import AttendanceDay, AttendanceStatus
from src.models.hr_leave import LeaveRequest, LeaveStatus, LeaveType
from src.models.hr_org import Department, EmployeeTermination
from src.models.hr_payroll_run import PayrollLine, PayrollLineDetail, PayrollRun
from src.models.org import Branch
from src.services import advance_service, leave_service

ZERO_QTY = Decimal("0.000")

SUBJECTS = ("headcount", "attendance", "leave", "payroll", "cost", "advance", "adjustment")
LEVELS = ("detail", "summary")
GROUPS = ("none", "employee", "department", "branch", "job_title", "month", "status", "component")

DEFAULT_LIMIT = 500
MAX_LIMIT = 5000


class HrReportError(Exception):
    pass


def _as_date(value) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return datetime.fromisoformat(str(value)[:19]).date()


def _lookups(db: Session) -> dict:
    return {
        "employees": {e.id: e for e in db.scalars(select(Employee)).all()},
        "departments": {d.id: d.name for d in db.scalars(select(Department)).all()},
        "branches": {b.id: b.name for b in db.scalars(select(Branch)).all()},
        "titles": {t.id: t.name for t in db.scalars(select(JobTitle)).all()},
    }


def _row(look: dict, employee, *, period: str = "", label: str = "",
         quantity=ZERO_QTY, amount=ZERO, status: str = "", extra: dict | None = None) -> dict:
    """الشكل الموحّد اللي كل موضوع بيتسطّح ليه."""
    return {
        "employee_id": employee.id if employee else None,
        "employee_name": employee.name if employee else None,
        "department_id": employee.department_id if employee else None,
        "department": (look["departments"].get(employee.department_id)
                       if employee else None) or (employee.department if employee else None),
        "branch_id": employee.branch_id if employee else None,
        "branch": look["branches"].get(employee.branch_id) if employee else None,
        "job_title_id": employee.job_title_id if employee else None,
        "job_title": look["titles"].get(employee.job_title_id) if employee else None,
        "period": period,
        "label": label,
        "status": status,
        "quantity": str(to_qty(Decimal(str(quantity or 0)))),
        "amount": str(to_money(Decimal(str(amount or 0)))),
        **(extra or {}),
    }


# ------------------------------------------------------------------ التجميع


def _collect(db: Session, subject: str, filters: dict) -> list[dict]:
    look = _lookups(db)
    date_from = _as_date(filters.get("date_from"))
    date_to = _as_date(filters.get("date_to"))
    employee_id = filters.get("employee_id")
    department_id = filters.get("department_id")
    branch_id = filters.get("branch_id")

    def keep(employee: Employee) -> bool:
        if employee is None:
            return False
        if employee_id and employee.id != employee_id:
            return False
        if department_id and employee.department_id != department_id:
            return False
        if branch_id and employee.branch_id != branch_id:
            return False
        return True

    if subject == "headcount":
        return _collect_headcount(db, look, keep, date_from, date_to)
    if subject == "attendance":
        return _collect_attendance(db, look, keep, date_from, date_to)
    if subject == "leave":
        return _collect_leave(db, look, keep, date_from, date_to)
    if subject in ("payroll", "cost"):
        return _collect_payroll(db, look, keep, filters, by_component=(subject == "cost"))
    if subject == "advance":
        return _collect_advances(db, look, keep, date_from, date_to)
    if subject == "adjustment":
        return _collect_adjustments(db, look, keep, filters)
    raise HrReportError(f"موضوع تقرير مش معروف: {subject}")


def _collect_headcount(db, look, keep, date_from, date_to) -> list[dict]:
    """كشف الموظفين — والداخلين والخارجين لو اتحدد مدى."""
    terminations = {t.employee_id: t for t in db.scalars(select(EmployeeTermination)).all()}
    rows = []
    for employee in look["employees"].values():
        if not keep(employee):
            continue
        left = terminations.get(employee.id)
        if date_from or date_to:
            # المدى بيسأل عن حركة: اتعيّن أو مشي جوّه الفترة.
            hired_in = employee.hire_date and (
                (not date_from or employee.hire_date >= date_from)
                and (not date_to or employee.hire_date <= date_to))
            left_in = left and (
                (not date_from or left.end_date >= date_from)
                and (not date_to or left.end_date <= date_to))
            if not hired_in and not left_in:
                continue
        rows.append(_row(
            look, employee,
            period=str(employee.hire_date) if employee.hire_date else "",
            label="مغادرة" if left else "على رأس العمل",
            status="left" if left else ("active" if employee.active else "inactive"),
            amount=employee.salary or 0,
            extra={"hire_date": str(employee.hire_date) if employee.hire_date else None,
                   "end_date": str(left.end_date) if left else None,
                   "code": employee.code},
        ))
    return rows


_ATTENDANCE_LABEL = {
    AttendanceStatus.present: "حاضر", AttendanceStatus.absent: "غايب",
    AttendanceStatus.leave: "أجازة", AttendanceStatus.holiday: "عطلة",
    AttendanceStatus.weekend: "راحة", AttendanceStatus.mission: "مأمورية",
}


def _collect_attendance(db, look, keep, date_from, date_to) -> list[dict]:
    stmt = select(AttendanceDay).order_by(AttendanceDay.work_date, AttendanceDay.employee_id)
    # الفلترة في SQL مش في بايثون — الجدول ده موظفين × أيام.
    if date_from:
        stmt = stmt.where(AttendanceDay.work_date >= date_from)
    if date_to:
        stmt = stmt.where(AttendanceDay.work_date <= date_to)

    rows = []
    for day in db.scalars(stmt).all():
        employee = look["employees"].get(day.employee_id)
        if not keep(employee):
            continue
        rows.append(_row(
            look, employee,
            period=str(day.work_date)[:7],
            label=_ATTENDANCE_LABEL.get(day.status, day.status.value),
            status=day.status.value,
            quantity=1,
            extra={
                "work_date": str(day.work_date),
                "check_in": day.check_in, "check_out": day.check_out,
                "late_minutes": day.late_minutes,
                "early_leave_minutes": day.early_leave_minutes,
                "worked_hours": str(day.worked_hours),
                "overtime_hours": str(day.overtime_hours),
                "locked": day.locked_by_payroll_run_id is not None,
            },
        ))
    return rows


def _collect_leave(db, look, keep, date_from, date_to) -> list[dict]:
    types = {t.id: t.name for t in db.scalars(select(LeaveType)).all()}
    stmt = select(LeaveRequest).order_by(LeaveRequest.date_from)
    if date_from:
        stmt = stmt.where(LeaveRequest.date_to >= date_from)
    if date_to:
        stmt = stmt.where(LeaveRequest.date_from <= date_to)

    rows = []
    for request in db.scalars(stmt).all():
        employee = look["employees"].get(request.employee_id)
        if not keep(employee):
            continue
        rows.append(_row(
            look, employee,
            period=str(request.date_from)[:7],
            label=types.get(request.leave_type_id, ""),
            status=request.status.value,
            quantity=request.days,
            extra={"document_number": request.document_number,
                   "date_from": str(request.date_from), "date_to": str(request.date_to),
                   "reason": request.reason,
                   "approved": request.status == LeaveStatus.approved},
        ))
    return rows


def _collect_payroll(db, look, keep, filters, *, by_component: bool) -> list[dict]:
    """سطور المسير — أو بنودها لما التقرير يبقى عن التكلفة بالبند."""
    runs = {r.id: r for r in db.scalars(select(PayrollRun)).all()}
    year, month = filters.get("year"), filters.get("month")
    run_ids = [r.id for r in runs.values()
               if (not year or r.year == year) and (not month or r.month == month)
               and (filters.get("include_drafts") or r.status.value == "posted")]
    if not run_ids:
        return []

    lines = db.scalars(select(PayrollLine).where(PayrollLine.run_id.in_(run_ids))).all()
    if not by_component:
        rows = []
        for line in lines:
            employee = look["employees"].get(line.employee_id)
            if not keep(employee):
                continue
            run = runs[line.run_id]
            rows.append(_row(
                look, employee,
                period=f"{run.year}-{run.month:02d}",
                label="مرتب", status=run.status.value,
                amount=line.net,
                extra={
                    "run_id": run.id, "document_number": run.document_number,
                    "basic": str(line.basic), "allowances": str(line.allowances),
                    "overtime_amount": str(line.overtime_amount),
                    "gross": str(line.gross),
                    "absence_deduction": str(line.absence_deduction),
                    "penalty_amount": str(line.penalty_amount),
                    "bonus_amount": str(line.bonus_amount),
                    "insurance_employee": str(line.insurance_employee),
                    "insurance_employer": str(line.insurance_employer),
                    "tax_amount": str(line.tax_amount),
                    "advance_deduction": str(line.advance_deduction),
                    "total_deductions": str(line.total_deductions),
                    "days_absent": str(line.days_absent),
                    "has_attendance": line.has_attendance, "paid": line.paid,
                },
            ))
        return rows

    by_line = {line.id: line for line in lines}
    details = db.scalars(select(PayrollLineDetail).where(
        PayrollLineDetail.line_id.in_(list(by_line)))).all() if by_line else []
    rows = []
    for detail in details:
        line = by_line[detail.line_id]
        employee = look["employees"].get(line.employee_id)
        if not keep(employee):
            continue
        run = runs[line.run_id]
        rows.append(_row(
            look, employee,
            period=f"{run.year}-{run.month:02d}",
            label=detail.label, status=detail.kind.value,
            quantity=detail.quantity or 0, amount=detail.amount,
            extra={"source": detail.source.value, "component_id": detail.component_id,
                   "run_id": run.id},
        ))
    return rows


def _collect_advances(db, look, keep, date_from, date_to) -> list[dict]:
    stmt = select(EmployeeAdvance).order_by(EmployeeAdvance.advance_date)
    if date_from:
        stmt = stmt.where(EmployeeAdvance.advance_date >= date_from)
    if date_to:
        stmt = stmt.where(EmployeeAdvance.advance_date <= date_to)

    rows = []
    for advance in db.scalars(stmt).all():
        employee = look["employees"].get(advance.employee_id)
        if not keep(employee):
            continue
        rows.append(_row(
            look, employee,
            period=str(advance.advance_date)[:7],
            label=advance.reason or advance.document_number,
            status=advance.status.value,
            amount=advance.amount,
            extra={
                "document_number": advance.document_number,
                "advance_date": str(advance.advance_date),
                "instalments": advance.instalments,
                "taken": str(advance_service.taken_of(db, advance.id)),
                # المتبقي هو الرقم اللي أي حد بيسأل عن سلفة بيقصده.
                "outstanding": str(advance_service.outstanding_of(db, advance)),
            },
        ))
    return rows


def _collect_adjustments(db, look, keep, filters) -> list[dict]:
    stmt = select(PayrollAdjustment).order_by(
        PayrollAdjustment.year, PayrollAdjustment.month)
    if filters.get("year"):
        stmt = stmt.where(PayrollAdjustment.year == filters["year"])
    if filters.get("month"):
        stmt = stmt.where(PayrollAdjustment.month == filters["month"])

    rows = []
    for row in db.scalars(stmt).all():
        employee = look["employees"].get(row.employee_id)
        if not keep(employee):
            continue
        rows.append(_row(
            look, employee,
            period=f"{row.year}-{row.month:02d}",
            label=row.reason or row.document_number,
            status=row.kind.value,
            quantity=row.quantity or 0, amount=row.amount,
            extra={"document_number": row.document_number, "basis": row.basis.value,
                   "applied": row.payroll_line_id is not None},
        ))
    return rows


# ------------------------------------------------------------------ التجميع


_GROUP_KEY = {
    "employee": ("employee_id", "employee_name"),
    "department": ("department_id", "department"),
    "branch": ("branch_id", "branch"),
    "job_title": ("job_title_id", "job_title"),
    "month": ("period", "period"),
    "status": ("status", "status"),
    "component": ("label", "label"),
}


def _group(rows: list[dict], group_by: str) -> list[dict]:
    key_field, label_field = _GROUP_KEY[group_by]
    buckets: dict = {}
    for row in rows:
        key = row.get(key_field)
        bucket = buckets.setdefault(key, {
            "key": key, "label": row.get(label_field) or "— بدون —",
            "rows": 0, "quantity": ZERO_QTY, "amount": ZERO,
        })
        bucket["rows"] += 1
        bucket["quantity"] += Decimal(row["quantity"])
        bucket["amount"] += Decimal(row["amount"])
    out = [{
        "key": b["key"], "label": b["label"], "rows": b["rows"],
        "quantity": str(to_qty(b["quantity"])), "amount": str(to_money(b["amount"])),
    } for b in buckets.values()]
    out.sort(key=lambda r: Decimal(r["amount"]), reverse=True)
    return out


def _totals(rows: list[dict]) -> dict:
    """محسوبة على كل الصفوف المفلترة، **مش** على الصفحة المعروضة.

    A total that describes the visible page is worse than no total: it looks like an answer to
    «الشهر ده كلّفنا كام» and it is the answer for the first five hundred rows only.
    """
    return {
        "rows": len(rows),
        "quantity": str(to_qty(sum((Decimal(r["quantity"]) for r in rows), ZERO_QTY))),
        "amount": str(to_money(sum((Decimal(r["amount"]) for r in rows), ZERO))),
    }


def hr(
    db: Session,
    *,
    subject: str = "payroll",
    level: str = "detail",
    group_by: str = "none",
    date_from=None,
    date_to=None,
    year: int | None = None,
    month: int | None = None,
    employee_id: int | None = None,
    department_id: int | None = None,
    branch_id: int | None = None,
    status: str | None = None,
    include_drafts: bool = False,
    limit: int | None = None,
    offset: int = 0,
) -> dict:
    """محرك واحد. `subject` × `level` × `group_by` = أربعين تقرير."""
    if subject not in SUBJECTS:
        raise HrReportError(f"موضوع مش معروف: {subject}")
    if level not in LEVELS:
        raise HrReportError(f"مستوى مش معروف: {level}")
    if group_by not in GROUPS:
        raise HrReportError(f"تجميع مش معروف: {group_by}")
    if level == "summary" and group_by == "none":
        raise HrReportError("الملخّص محتاج تجميع.")

    rows = _collect(db, subject, {
        "date_from": date_from, "date_to": date_to, "year": year, "month": month,
        "employee_id": employee_id, "department_id": department_id,
        "branch_id": branch_id, "include_drafts": include_drafts,
    })
    if status:
        rows = [r for r in rows if r["status"] == status]

    totals = _totals(rows)

    if level == "summary" or group_by != "none":
        grouped = _group(rows, group_by)
        # المجمّع صغير بطبعه — مافيش ترقيم عليه.
        return {"subject": subject, "level": level, "group_by": group_by,
                "rows": grouped, "totals": totals,
                "page": {"limit": None, "offset": 0, "total_rows": len(grouped),
                         "truncated": False}}

    size = min(int(limit or DEFAULT_LIMIT), MAX_LIMIT) if limit != 0 else len(rows)
    start = max(0, int(offset or 0))
    page = rows[start:start + size] if size else rows[start:]
    return {
        "subject": subject, "level": level, "group_by": group_by,
        "rows": page, "totals": totals,
        "page": {"limit": size or None, "offset": start, "total_rows": len(rows),
                 "truncated": start + len(page) < len(rows)},
    }


def leave_balances(db: Session, *, year: int, employee_id: int | None = None) -> dict:
    """أرصدة الأجازات — بتقعد جنب المحرك لأن الرصيد مشتق مش صف في جدول."""
    types = db.scalars(select(LeaveType).where(LeaveType.active.is_(True))).all()
    stmt = select(Employee).where(Employee.active.is_(True))
    if employee_id:
        stmt = select(Employee).where(Employee.id == employee_id)
    look = _lookups(db)

    rows = []
    for employee in db.scalars(stmt).all():
        for kind in types:
            state = leave_service.balance(
                db, employee_id=employee.id, leave_type_id=kind.id, year=year)
            rows.append({
                **_row(look, employee, period=str(year), label=kind.name,
                       quantity=state["remaining"]),
                "opening": state["opening"], "entitled": state["entitled"],
                "adjustment": state["adjustment"], "taken": state["taken"],
                "remaining": state["remaining"],
            })
    return {"subject": "leave_balance", "level": "detail", "group_by": "none",
            "rows": rows, "totals": _totals(rows),
            "page": {"limit": None, "offset": 0, "total_rows": len(rows),
                     "truncated": False}}
