from __future__ import annotations

from datetime import date

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from src.lib import attendance_calc as calc
from src.lib import attendance_import as importer
from src.models.employee import Employee
from src.models.hr_attendance import (
    AttendanceDay,
    AttendanceImport,
    AttendanceSource,
    AttendanceStatus,
    EmployeeShiftAssignment,
    Holiday,
    WorkShift,
)
from src.services import audit_service, numbering


class AttendanceError(Exception):
    pass


class AttendanceLocked(AttendanceError):
    pass


def create_shift(
    db: Session, *, name: str, start_time: str, end_time: str, actor_user_id: int,
    break_minutes: int = 0, grace_minutes: int = 0, weekend_days: str = "4,5",
    is_default: bool = False,
) -> WorkShift:
    clean = (name or "").strip()
    if not clean:
        raise AttendanceError("اسم الوردية مطلوب.")
    if db.scalar(select(WorkShift).where(WorkShift.name == clean)):
        raise AttendanceError("فيه وردية بنفس الاسم.")
    try:
        calc.shift_span(start_time, end_time)
    except calc.AttendanceError as exc:
        raise AttendanceError(str(exc)) from exc

    if is_default:
        _clear_default(db)
    shift = WorkShift(
        name=clean, start_time=start_time, end_time=end_time,
        break_minutes=break_minutes, grace_minutes=grace_minutes,
        weekend_days=weekend_days, is_default=is_default,
    )
    db.add(shift)
    db.flush()
    audit_service.record(
        db, action="work_shift.create", actor_user_id=actor_user_id,
        entity_type="work_shift", entity_id=shift.id,
        after={"name": shift.name, "start": start_time, "end": end_time},
    )
    return shift


def _clear_default(db: Session) -> None:
    for other in db.scalars(select(WorkShift).where(WorkShift.is_default.is_(True))).all():
        other.is_default = False


def assign_shift(
    db: Session, *, employee_id: int, shift_id: int, effective_from: date, actor_user_id: int,
) -> EmployeeShiftAssignment:
    if db.get(Employee, employee_id) is None:
        raise AttendanceError("الموظف غير موجود.")
    if db.get(WorkShift, shift_id) is None:
        raise AttendanceError("الوردية غير موجودة.")
    existing = db.scalar(select(EmployeeShiftAssignment).where(
        EmployeeShiftAssignment.employee_id == employee_id,
        EmployeeShiftAssignment.effective_from == effective_from))
    if existing is not None:
        existing.shift_id = shift_id
        db.flush()
        return existing
    row = EmployeeShiftAssignment(
        employee_id=employee_id, shift_id=shift_id, effective_from=effective_from,
        actor_user_id=actor_user_id,
    )
    db.add(row)
    db.flush()
    audit_service.record(
        db, action="shift.assign", actor_user_id=actor_user_id,
        entity_type="employee", entity_id=employee_id,
        after={"shift_id": shift_id, "from": str(effective_from)},
    )
    return row


def shift_for(db: Session, employee_id: int, day: date) -> WorkShift | None:
    assignment = db.scalar(
        select(EmployeeShiftAssignment)
        .where(EmployeeShiftAssignment.employee_id == employee_id,
               EmployeeShiftAssignment.effective_from <= day)
        .order_by(EmployeeShiftAssignment.effective_from.desc())
    )
    if assignment is not None:
        return db.get(WorkShift, assignment.shift_id)
    return db.scalar(select(WorkShift).where(
        WorkShift.is_default.is_(True), WorkShift.active.is_(True)))


def add_holiday(
    db: Session, *, name: str, holiday_date: date, actor_user_id: int,
    paid: bool = True, branch_id: int | None = None,
) -> Holiday:
    clean = (name or "").strip()
    if not clean:
        raise AttendanceError("اسم العطلة مطلوب.")
    clash = db.scalar(select(Holiday).where(
        Holiday.holiday_date == holiday_date,
        Holiday.branch_id.is_(None) if branch_id is None else Holiday.branch_id == branch_id,
        Holiday.active.is_(True)))
    if clash is not None:
        raise AttendanceError("فيه عطلة مسجّلة في نفس اليوم.")
    row = Holiday(name=clean, holiday_date=holiday_date, paid=paid, branch_id=branch_id)
    db.add(row)
    db.flush()
    audit_service.record(
        db, action="holiday.create", actor_user_id=actor_user_id,
        entity_type="holiday", entity_id=row.id,
        after={"name": clean, "date": str(holiday_date)},
    )
    return row


def is_holiday(db: Session, day: date, branch_id: int | None = None) -> Holiday | None:
    rows = db.scalars(select(Holiday).where(
        Holiday.holiday_date == day, Holiday.active.is_(True))).all()
    for row in rows:
        if row.branch_id is not None and row.branch_id == branch_id:
            return row
    for row in rows:
        if row.branch_id is None:
            return row
    return None


def _assert_open(day: AttendanceDay | None) -> None:
    if day is not None and day.locked_by_payroll_run_id is not None:
        raise AttendanceLocked(
            f"اليوم ده داخل مسير مرحّل رقم {day.locked_by_payroll_run_id} — "
            "اعكس المسير الأول."
        )


def record_day(
    db: Session,
    *,
    employee_id: int,
    work_date: date,
    actor_user_id: int,
    check_in: str | None = None,
    check_out: str | None = None,
    status: AttendanceStatus | None = None,
    notes: str | None = None,
    source: AttendanceSource = AttendanceSource.manual,
    import_batch_id: int | None = None,
) -> AttendanceDay:
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise AttendanceError("الموظف غير موجود.")

    row = db.scalar(select(AttendanceDay).where(
        AttendanceDay.employee_id == employee_id, AttendanceDay.work_date == work_date))
    _assert_open(row)

    shift = shift_for(db, employee_id, work_date)
    resolved = status or _derive_status(db, employee, work_date, shift, check_in)

    figures = {"late_minutes": 0, "early_leave_minutes": 0,
               "worked_hours": calc.ZERO_QTY, "overtime_hours": calc.ZERO_QTY}
    if shift is not None and check_in:
        try:
            figures = calc.day_figures(
                check_in=check_in, check_out=check_out,
                shift_start=shift.start_time, shift_end=shift.end_time,
                break_minutes=shift.break_minutes, grace_minutes=shift.grace_minutes,
            )
        except calc.AttendanceError as exc:
            raise AttendanceError(str(exc)) from exc

    if row is None:
        row = AttendanceDay(employee_id=employee_id, work_date=work_date)
        db.add(row)
    else:
        row.updated_at = func.now()

    row.status = resolved
    row.check_in = check_in
    row.check_out = check_out
    row.shift_id = shift.id if shift else None
    row.source = source
    row.import_batch_id = import_batch_id
    row.notes = notes
    row.actor_user_id = actor_user_id
    row.late_minutes = figures["late_minutes"]
    row.early_leave_minutes = figures["early_leave_minutes"]
    row.worked_hours = figures["worked_hours"]
    row.overtime_hours = figures["overtime_hours"]
    db.flush()
    return row


def _derive_status(
    db: Session, employee: Employee, day: date, shift: WorkShift | None, check_in: str | None,
) -> AttendanceStatus:
    if is_holiday(db, day, employee.branch_id) is not None:
        return AttendanceStatus.holiday
    if shift is not None and calc.is_weekend(day, shift.weekend_days):
        return AttendanceStatus.weekend
    return AttendanceStatus.present if check_in else AttendanceStatus.absent


def delete_day(db: Session, *, day_id: int, actor_user_id: int) -> None:
    row = db.get(AttendanceDay, day_id)
    if row is None:
        raise AttendanceError("اليوم غير موجود.")
    _assert_open(row)
    audit_service.record(
        db, action="attendance.delete", actor_user_id=actor_user_id,
        entity_type="attendance_day", entity_id=row.id,
        before={"employee_id": row.employee_id, "date": str(row.work_date)},
    )
    db.delete(row)
    db.flush()


def _match_employees(db: Session, branch_id: int | None = None) -> dict[str, int]:
    stmt = select(Employee)
    if branch_id is not None:
        stmt = stmt.where(or_(Employee.branch_id == branch_id, Employee.branch_id.is_(None)))
    keys: dict[str, int] = {}
    for emp in db.scalars(stmt).all():
        for candidate in (emp.code, emp.national_id, emp.name):
            if candidate:
                keys.setdefault(str(candidate).strip(), emp.id)
    return keys


def preview_import(db: Session, *, rows: list[list[str]], mapping: importer.ColumnMap,
                   branch_id: int | None = None) -> dict:
    return _plan(db, rows=rows, mapping=mapping, branch_id=branch_id)


def _plan(db: Session, *, rows: list[list[str]], mapping: importer.ColumnMap,
          branch_id: int | None = None) -> dict:
    parsed = importer.parse(rows, mapping)
    folded = importer.fold_days(parsed.punches)
    keys = _match_employees(db, branch_id)

    matched, unmatched, locked = [], [], []
    for (key, day), slot in sorted(folded.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        employee_id = keys.get(key)
        if employee_id is None:
            unmatched.append({"employee_key": key, "date": str(day)})
            continue
        existing = db.scalar(select(AttendanceDay).where(
            AttendanceDay.employee_id == employee_id, AttendanceDay.work_date == day))
        if existing is not None and existing.locked_by_payroll_run_id is not None:
            locked.append({"employee_id": employee_id, "date": str(day)})
            continue
        matched.append({
            "employee_id": employee_id, "employee_key": key, "date": str(day),
            "check_in": slot["check_in"], "check_out": slot["check_out"],
            "existing": existing is not None,
        })

    days = [d for _, d in folded]
    return {
        "rows_total": len(rows),
        "punches": len(parsed.punches),
        "matched": matched,
        "unmatched": unmatched,
        "locked": locked,
        "rejected": [{"line": line, "reason": reason} for line, reason in parsed.rejected],
        "date_from": str(min(days)) if days else None,
        "date_to": str(max(days)) if days else None,
    }


def apply_import(
    db: Session, *, rows: list[list[str]], mapping: importer.ColumnMap, actor_user_id: int,
    filename: str | None = None, branch_id: int | None = None,
) -> dict:
    plan = _plan(db, rows=rows, mapping=mapping, branch_id=branch_id)
    batch = AttendanceImport(
        document_number=numbering.next_document_number(db, AttendanceImport, "ATT"),
        filename=filename,
        date_from=date.fromisoformat(plan["date_from"]) if plan["date_from"] else None,
        date_to=date.fromisoformat(plan["date_to"]) if plan["date_to"] else None,
        rows_total=plan["rows_total"],
        actor_user_id=actor_user_id,
    )
    db.add(batch)
    db.flush()

    created = updated = 0
    for entry in plan["matched"]:
        was_there = entry["existing"]
        record_day(
            db,
            employee_id=entry["employee_id"],
            work_date=date.fromisoformat(entry["date"]),
            check_in=entry["check_in"], check_out=entry["check_out"],
            actor_user_id=actor_user_id,
            source=AttendanceSource.import_file, import_batch_id=batch.id,
        )
        if was_there:
            updated += 1
        else:
            created += 1

    batch.rows_created = created
    batch.rows_updated = updated
    batch.rows_skipped = len(plan["unmatched"]) + len(plan["locked"]) + len(plan["rejected"])
    db.flush()
    audit_service.record(
        db, action="attendance.import", actor_user_id=actor_user_id,
        entity_type="attendance_import", entity_id=batch.id,
        after={"created": created, "updated": updated, "skipped": batch.rows_skipped},
    )
    return {
        "import_id": batch.id, "document_number": batch.document_number,
        "created": created, "updated": updated,
        "unmatched": plan["unmatched"], "locked": plan["locked"],
        "rejected": plan["rejected"],
    }
