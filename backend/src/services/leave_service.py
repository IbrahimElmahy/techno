"""الأجازات — الطلبات والأرصدة (HR-3).

Approving a request WRITES `attendance_day` rows with `status=leave`, so payroll and every
attendance report read one truth. Cancelling takes them back — unless a day has since been locked
by a posted payroll run, in which case the cancellation is refused rather than half-applied.

The balance is derived, never stored: `taken()` sums the approved requests. See the note in
`models/hr_leave.py` for why.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.core.money import to_qty
from src.lib import attendance_calc as calc
from src.models.employee import Employee
from src.models.hr_attendance import AttendanceDay, AttendanceSource, AttendanceStatus
from src.models.hr_leave import LeaveEntitlement, LeaveRequest, LeaveStatus, LeaveType
from src.services import attendance_service, audit_service, numbering

ZERO_QTY = Decimal("0.000")


class LeaveError(Exception):
    """الطلب مايتعملش زي ما هو مكتوب."""


# ------------------------------------------------------------------ الأنواع


def create_type(
    db: Session, *, name: str, actor_user_id: int, code: str | None = None,
    annual_quota=0, paid: bool = True, deducts_salary: bool = False,
    affects_balance: bool = True, requires_approval: bool = True,
    counts_weekend: bool = False, carry_over_max=None, notes: str | None = None,
) -> LeaveType:
    clean = (name or "").strip()
    if not clean:
        raise LeaveError("اسم نوع الأجازة مطلوب.")
    if db.scalar(select(LeaveType).where(LeaveType.name == clean)):
        raise LeaveError("فيه نوع أجازة بنفس الاسم.")
    wanted = (code or "").strip() or numbering.next_document_number(
        db, LeaveType, "LVT", column=LeaveType.code, width=3)
    row = LeaveType(
        code=wanted, name=clean, annual_quota=annual_quota, paid=paid,
        deducts_salary=deducts_salary, affects_balance=affects_balance,
        requires_approval=requires_approval, counts_weekend=counts_weekend,
        carry_over_max=carry_over_max, notes=notes,
    )
    db.add(row)
    db.flush()
    audit_service.record(
        db, action="leave_type.create", actor_user_id=actor_user_id,
        entity_type="leave_type", entity_id=row.id, after={"name": clean},
    )
    return row


# ------------------------------------------------------------------ الأيام


def working_days(
    db: Session, *, employee_id: int, date_from: date, date_to: date, counts_weekend: bool,
) -> Decimal:
    """عدد الأيام اللي الأجازة بتاكلها فعلاً.

    «أسبوع أجازة» and «خمس أيام أجازة» are different requests over the same dates, and which one
    was meant is a property of the leave TYPE, not of the person asking. Public holidays never
    count against a leave balance — the company was closed anyway, and charging somebody for it is
    the kind of thing that gets noticed once and remembered for years.
    """
    if date_to < date_from:
        raise LeaveError("تاريخ النهاية قبل البداية.")
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise LeaveError("الموظف غير موجود.")

    shift = attendance_service.shift_for(db, employee_id, date_from)
    weekend_csv = shift.weekend_days if shift else "4,5"

    total = 0
    day = date_from
    while day <= date_to:
        skip = False
        if not counts_weekend:
            if calc.is_weekend(day, weekend_csv):
                skip = True
            elif attendance_service.is_holiday(db, day, employee.branch_id) is not None:
                skip = True
        if not skip:
            total += 1
        day += timedelta(days=1)
    return to_qty(Decimal(total))


# ------------------------------------------------------------------ الرصيد


def taken(db: Session, *, employee_id: int, leave_type_id: int, year: int) -> Decimal:
    """المستهلك — مجموع الطلبات المعتمدة، محسوب مش مخزّن."""
    total = db.scalar(
        select(func.coalesce(func.sum(LeaveRequest.days), 0))
        .where(LeaveRequest.employee_id == employee_id,
               LeaveRequest.leave_type_id == leave_type_id,
               LeaveRequest.status == LeaveStatus.approved,
               LeaveRequest.date_from >= date(year, 1, 1),
               LeaveRequest.date_from <= date(year, 12, 31))
    ) or 0
    return to_qty(Decimal(str(total)))


def balance(db: Session, *, employee_id: int, leave_type_id: int, year: int) -> dict:
    """الرصيد كامل: المرحّل + المستحق + التسوية − المستهلك."""
    row = db.scalar(select(LeaveEntitlement).where(
        LeaveEntitlement.employee_id == employee_id,
        LeaveEntitlement.leave_type_id == leave_type_id,
        LeaveEntitlement.year == year))
    kind = db.get(LeaveType, leave_type_id)
    opening = to_qty(Decimal(str(row.opening))) if row else ZERO_QTY
    # مافيش صف مستحق؟ يبقى الرصيد الافتراضي للنوع — الموظف الجديد مايبقاش رصيده صفر
    # لمجرد إن محدش فتحله صف.
    entitled = (to_qty(Decimal(str(row.entitled))) if row
                else to_qty(Decimal(str(kind.annual_quota))) if kind else ZERO_QTY)
    adjustment = to_qty(Decimal(str(row.adjustment))) if row else ZERO_QTY
    used = taken(db, employee_id=employee_id, leave_type_id=leave_type_id, year=year)
    return {
        "employee_id": employee_id, "leave_type_id": leave_type_id, "year": year,
        "opening": str(opening), "entitled": str(entitled), "adjustment": str(adjustment),
        "taken": str(used),
        "remaining": str(to_qty(opening + entitled + adjustment - used)),
    }


def set_entitlement(
    db: Session, *, employee_id: int, leave_type_id: int, year: int, actor_user_id: int,
    opening=None, entitled=None, adjustment=None, notes: str | None = None,
) -> LeaveEntitlement:
    row = db.scalar(select(LeaveEntitlement).where(
        LeaveEntitlement.employee_id == employee_id,
        LeaveEntitlement.leave_type_id == leave_type_id,
        LeaveEntitlement.year == year))
    if row is None:
        row = LeaveEntitlement(employee_id=employee_id, leave_type_id=leave_type_id, year=year)
        db.add(row)
    if opening is not None:
        row.opening = opening
    if entitled is not None:
        row.entitled = entitled
    if adjustment is not None:
        row.adjustment = adjustment
    if notes is not None:
        row.notes = notes
    row.actor_user_id = actor_user_id
    db.flush()
    audit_service.record(
        db, action="leave_entitlement.set", actor_user_id=actor_user_id,
        entity_type="employee", entity_id=employee_id,
        after={"year": year, "type": leave_type_id, "entitled": str(row.entitled)},
    )
    return row


# ------------------------------------------------------------------ الطلبات


def request(
    db: Session, *, employee_id: int, leave_type_id: int, date_from: date, date_to: date,
    actor_user_id: int, reason: str | None = None,
) -> LeaveRequest:
    kind = db.get(LeaveType, leave_type_id)
    if kind is None:
        raise LeaveError("نوع الأجازة غير موجود.")
    if db.get(Employee, employee_id) is None:
        raise LeaveError("الموظف غير موجود.")

    overlap = db.scalar(select(LeaveRequest).where(
        LeaveRequest.employee_id == employee_id,
        LeaveRequest.status.in_([LeaveStatus.submitted, LeaveStatus.approved]),
        LeaveRequest.date_from <= date_to,
        LeaveRequest.date_to >= date_from))
    if overlap is not None:
        raise LeaveError(f"فيه طلب أجازة على نفس الأيام: {overlap.document_number}")

    days = working_days(db, employee_id=employee_id, date_from=date_from, date_to=date_to,
                        counts_weekend=kind.counts_weekend)
    if days <= 0:
        raise LeaveError("المدة دي كلها عطلات وراحات — مافيش أيام شغل فيها.")

    row = LeaveRequest(
        document_number=numbering.next_document_number(db, LeaveRequest, "LV"),
        employee_id=employee_id, leave_type_id=leave_type_id,
        date_from=date_from, date_to=date_to, days=days, reason=reason,
        status=LeaveStatus.submitted if kind.requires_approval else LeaveStatus.approved,
        actor_user_id=actor_user_id,
    )
    db.add(row)
    db.flush()
    if row.status == LeaveStatus.approved:
        _write_days(db, row, actor_user_id=actor_user_id)
    audit_service.record(
        db, action="leave.request", actor_user_id=actor_user_id,
        entity_type="leave_request", entity_id=row.id,
        after={"employee_id": employee_id, "days": str(days),
               "from": str(date_from), "to": str(date_to)},
    )
    return row


def approve(db: Session, *, request_id: int, actor_user_id: int) -> LeaveRequest:
    """بيعتمد الطلب وبيكتب أيام الحضور — مصدر واحد للحقيقة."""
    row = db.get(LeaveRequest, request_id)
    if row is None:
        raise LeaveError("الطلب غير موجود.")
    if row.status == LeaveStatus.approved:
        # اعتماد تاني من شاشة تانية: مابيرميش خطأ ومابيخصمش تاني.
        return row
    if row.status in (LeaveStatus.rejected, LeaveStatus.cancelled):
        raise LeaveError("الطلب ده متقفل — اعمل طلب جديد.")

    kind = db.get(LeaveType, row.leave_type_id)
    if kind is not None and kind.affects_balance:
        year = row.date_from.year
        state = balance(db, employee_id=row.employee_id,
                        leave_type_id=row.leave_type_id, year=year)
        if Decimal(state["remaining"]) < to_qty(Decimal(str(row.days))):
            raise LeaveError(
                f"الرصيد مايكفيش — متبقي {state['remaining']} والطلب {row.days}.")

    row.status = LeaveStatus.approved
    row.approved_by_user_id = actor_user_id
    row.approved_at = func.now()
    db.flush()
    _write_days(db, row, actor_user_id=actor_user_id)
    audit_service.record(
        db, action="leave.approve", actor_user_id=actor_user_id,
        entity_type="leave_request", entity_id=row.id, after={"status": "approved"},
    )
    return row


def _write_days(db: Session, row: LeaveRequest, *, actor_user_id: int) -> None:
    """بيحط أيام الحضور بحالة «أجازة» — عشان المسير يقرا حاجة واحدة."""
    kind = db.get(LeaveType, row.leave_type_id)
    employee = db.get(Employee, row.employee_id)
    shift = attendance_service.shift_for(db, row.employee_id, row.date_from)
    weekend_csv = shift.weekend_days if shift else "4,5"

    day = row.date_from
    while day <= row.date_to:
        skip = False
        if not (kind and kind.counts_weekend):
            if calc.is_weekend(day, weekend_csv):
                skip = True
            elif attendance_service.is_holiday(db, day, employee.branch_id) is not None:
                skip = True
        if not skip:
            existing = db.scalar(select(AttendanceDay).where(
                AttendanceDay.employee_id == row.employee_id, AttendanceDay.work_date == day))
            # يوم مقفول بمسير مرحّل بيتسكت عنه بدل ما الاعتماد كله يقع: باقي الأيام أولى
            # بالتسجيل، والشهر المقفول مش هيتغيّر من ورا المحاسب.
            if existing is None or existing.locked_by_payroll_run_id is None:
                attendance_service.record_day(
                    db, employee_id=row.employee_id, work_date=day,
                    status=AttendanceStatus.leave, actor_user_id=actor_user_id,
                    source=AttendanceSource.generated,
                    notes=f"أجازة {row.document_number}",
                )
        day += timedelta(days=1)


def reject(db: Session, *, request_id: int, actor_user_id: int, reason: str | None = None):
    row = db.get(LeaveRequest, request_id)
    if row is None:
        raise LeaveError("الطلب غير موجود.")
    if row.status == LeaveStatus.approved:
        raise LeaveError("الطلب معتمد — الغيه بدل ما ترفضه.")
    row.status = LeaveStatus.rejected
    row.reject_reason = reason
    row.approved_by_user_id = actor_user_id
    db.flush()
    audit_service.record(
        db, action="leave.reject", actor_user_id=actor_user_id,
        entity_type="leave_request", entity_id=row.id, after={"status": "rejected"},
    )
    return row


def cancel(db: Session, *, request_id: int, actor_user_id: int) -> LeaveRequest:
    """بيلغي الطلب وبيشيل أيام الحضور اللي اتكتبت منه.

    Refused outright when any of its days has been locked by a posted payroll run: cancelling then
    would leave the balance saying the leave was never taken while the payroll it fed is already in
    the ledger saying it was.
    """
    row = db.get(LeaveRequest, request_id)
    if row is None:
        raise LeaveError("الطلب غير موجود.")
    if row.status == LeaveStatus.cancelled:
        return row

    days = db.scalars(select(AttendanceDay).where(
        AttendanceDay.employee_id == row.employee_id,
        AttendanceDay.work_date >= row.date_from,
        AttendanceDay.work_date <= row.date_to,
        AttendanceDay.status == AttendanceStatus.leave)).all()
    locked = [d for d in days if d.locked_by_payroll_run_id is not None]
    if locked:
        raise LeaveError(
            f"فيه أيام من الأجازة دي داخل مسير مرحّل رقم {locked[0].locked_by_payroll_run_id} "
            "— اعكس المسير الأول."
        )

    for entry in days:
        db.delete(entry)
    row.status = LeaveStatus.cancelled
    db.flush()
    audit_service.record(
        db, action="leave.cancel", actor_user_id=actor_user_id,
        entity_type="leave_request", entity_id=row.id,
        after={"status": "cancelled", "days_removed": len(days)},
    )
    return row
