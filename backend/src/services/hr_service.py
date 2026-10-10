from __future__ import annotations

from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.models.cost_center import CostCenter
from src.models.employee import Employee
from src.models.hr_org import Department, EmployeeTermination, TerminationKind
from src.services import audit_service, numbering


class HrError(Exception):
    pass


def _assert_no_cycle(db: Session, *, department_id: int, parent_id: int | None) -> None:
    seen = {department_id}
    cursor = parent_id
    while cursor is not None:
        if cursor in seen:
            raise HrError("لا يمكن أن يكون القسم تابعاً لنفسه.")
        seen.add(cursor)
        node = db.get(Department, cursor)
        cursor = node.parent_id if node else None


def _validate_links(db: Session, *, parent_id, manager_employee_id, cost_center_id, branch_id):
    if parent_id is not None and db.get(Department, parent_id) is None:
        raise HrError("القسم الأب غير موجود.")
    if manager_employee_id is not None and db.get(Employee, manager_employee_id) is None:
        raise HrError("المدير المختار ليس موظفاً موجوداً.")
    if cost_center_id is not None and db.get(CostCenter, cost_center_id) is None:
        raise HrError("مركز التكلفة غير موجود.")


def create_department(
    db: Session,
    *,
    name: str,
    actor_user_id: int,
    code: str | None = None,
    parent_id: int | None = None,
    manager_employee_id: int | None = None,
    cost_center_id: int | None = None,
    branch_id: int | None = None,
    notes: str | None = None,
) -> Department:
    clean = (name or "").strip()
    if not clean:
        raise HrError("اسم القسم مطلوب.")
    if db.scalar(select(Department).where(Department.name == clean)):
        raise HrError("يوجد قسم بالاسم نفسه.")
    wanted = (code or "").strip() or numbering.next_document_number(
        db, Department, "DEP", column=Department.code, width=3
    )
    if db.scalar(select(Department).where(Department.code == wanted)):
        raise HrError("كود القسم مستخدم مسبقاً.")
    _validate_links(db, parent_id=parent_id, manager_employee_id=manager_employee_id,
                    cost_center_id=cost_center_id, branch_id=branch_id)

    dept = Department(
        code=wanted, name=clean, parent_id=parent_id,
        manager_employee_id=manager_employee_id, cost_center_id=cost_center_id,
        branch_id=branch_id, notes=notes,
    )
    db.add(dept)
    db.flush()
    audit_service.record(
        db, action="department.create", actor_user_id=actor_user_id,
        entity_type="department", entity_id=dept.id,
        after={"code": dept.code, "name": dept.name, "parent_id": dept.parent_id},
    )
    return dept


def update_department(db: Session, *, department_id: int, actor_user_id: int, **fields) -> Department:
    dept = db.get(Department, department_id)
    if dept is None:
        raise HrError("القسم غير موجود.")
    before = {"name": dept.name, "parent_id": dept.parent_id, "active": dept.active}

    if "name" in fields and fields["name"] is not None:
        clean = fields["name"].strip()
        if not clean:
            raise HrError("اسم القسم مطلوب.")
        clash = db.scalar(select(Department).where(
            Department.name == clean, Department.id != department_id))
        if clash:
            raise HrError("يوجد قسم بالاسم نفسه.")
        fields["name"] = clean
    if "parent_id" in fields:
        if fields["parent_id"] == department_id:
            raise HrError("لا يمكن أن يكون القسم تابعاً لنفسه.")
        _assert_no_cycle(db, department_id=department_id, parent_id=fields["parent_id"])
    _validate_links(
        db,
        parent_id=fields.get("parent_id"),
        manager_employee_id=fields.get("manager_employee_id"),
        cost_center_id=fields.get("cost_center_id"),
        branch_id=fields.get("branch_id"),
    )

    for key, value in fields.items():
        setattr(dept, key, value)
    db.flush()
    audit_service.record(
        db, action="department.update", actor_user_id=actor_user_id,
        entity_type="department", entity_id=dept.id, before=before,
        after={"name": dept.name, "parent_id": dept.parent_id, "active": dept.active},
    )
    return dept


def deactivate_department(db: Session, *, department_id: int, actor_user_id: int) -> Department:
    dept = db.get(Department, department_id)
    if dept is None:
        raise HrError("القسم غير موجود.")
    inside = db.scalar(select(func.count()).select_from(Employee).where(
        Employee.department_id == department_id, Employee.active.is_(True))) or 0
    if inside:
        raise HrError(f"يوجد {inside} موظف نشط في هذا القسم — انقلهم أولاً.")
    children = db.scalar(select(func.count()).select_from(Department).where(
        Department.parent_id == department_id, Department.active.is_(True))) or 0
    if children:
        raise HrError(f"يوجد {children} قسم فرعي نشط تحته.")

    dept.active = False
    db.flush()
    audit_service.record(
        db, action="department.deactivate", actor_user_id=actor_user_id,
        entity_type="department", entity_id=dept.id, after={"active": False},
    )
    return dept


def import_departments_from_employees(db: Session, *, actor_user_id: int) -> dict:
    rows = db.scalars(select(Employee)).all()
    existing = {d.name: d for d in db.scalars(select(Department)).all()}
    created, linked = 0, 0

    for emp in rows:
        raw = (emp.department or "").strip()
        if not raw or emp.department_id is not None:
            continue
        dept = existing.get(raw)
        if dept is None:
            dept = create_department(db, name=raw, actor_user_id=actor_user_id)
            existing[raw] = dept
            created += 1
        emp.department_id = dept.id
        linked += 1

    db.flush()
    audit_service.record(
        db, action="department.import", actor_user_id=actor_user_id,
        entity_type="department", entity_id=None,
        after={"created": created, "linked": linked},
    )
    return {"created": created, "linked": linked, "employees": len(rows)}


_REF_LABELS: dict[tuple[str, str], str] = {
    ("employee", "department_id"): "موظف",
    ("department", "parent_id"): "قسم فرعي",
    ("department", "manager_employee_id"): "قسم يديره",
    ("customer", "employee_id"): "عميل مرتبط به",
    ("employee_salary", "employee_id"): "هيكل راتب",
    ("employee_shift_assignment", "employee_id"): "وردية",
    ("employee_termination", "employee_id"): "نهاية خدمة",
    ("leave_entitlement", "employee_id"): "رصيد إجازات",
    ("leave_request", "employee_id"): "طلب إجازة",
    ("payroll_adjustment", "employee_id"): "جزاء أو مكافأة",
    ("attendance_day", "employee_id"): "يوم حضور",
    ("attendance_punch", "employee_id"): "بصمة جهاز",
    ("employee_advance", "employee_id"): "سلفة",
    ("payroll_line", "employee_id"): "سطر مسير رواتب",
    ("payroll_line", "department_id"): "سطر مسير رواتب",
}


def _blockers(db: Session, referred_table: str, row_id: int) -> list[str]:
    from sqlalchemy import inspect as sa_inspect
    from sqlalchemy import text

    found: list[str] = []
    insp = sa_inspect(db.get_bind())
    for table in insp.get_table_names():
        for fk in insp.get_foreign_keys(table):
            if fk.get("referred_table") != referred_table:
                continue
            col = fk["constrained_columns"][0]
            n = db.execute(text(f'SELECT count(*) FROM "{table}" WHERE "{col}" = :i'),
                           {"i": row_id}).scalar() or 0
            if n:
                found.append(f"{_REF_LABELS.get((table, col), f'{table}.{col}')}: {n}")
    return found


def delete_department(db: Session, *, department_id: int, actor_user_id: int) -> None:
    dept = db.get(Department, department_id)
    if dept is None:
        raise HrError("القسم غير موجود.")
    found = _blockers(db, "department", department_id)
    if found:
        raise HrError("هذا القسم مرتبط به " + " · ".join(found[:6])
                      + " — فلا يمكن حذفه. انقل موظفيه إلى قسم آخر، أو استخدم «إقفال» بدلاً من الحذف.")
    audit_service.record(
        db, action="department.delete", actor_user_id=actor_user_id,
        entity_type="department", entity_id=dept.id,
        before={"code": dept.code, "name": dept.name, "parent_id": dept.parent_id},
    )
    db.delete(dept)
    db.flush()


def delete_employee(db: Session, *, employee: Employee, actor_user_id: int) -> None:
    found = _blockers(db, "employee", employee.id)
    if employee.user_id is not None:
        found.insert(0, "حساب دخول (مستخدم أو مندوب)")
    if employee.receivable_account_id is not None:
        from sqlalchemy import func as _f
        from sqlalchemy import select as _sel

        from src.models.ledger import LedgerLine
        n_lines = db.scalar(_sel(_f.count()).select_from(LedgerLine).where(
            LedgerLine.account_id == employee.receivable_account_id)) or 0
        if n_lines:
            found.insert(0, f"حساب ذمة عليه {n_lines} حركة في الدفتر")
    if found:
        raise HrError("هذا الموظف مرتبط به " + " · ".join(found[:6])
                      + " — فلا يمكن حذفه. استخدم «إيقاف» بدلاً من الحذف.")
    audit_service.record(
        db, action="employee.delete", actor_user_id=actor_user_id,
        entity_type="employee", entity_id=employee.id,
        before={"code": employee.code, "name": employee.name,
                "department_id": employee.department_id, "branch_id": employee.branch_id},
    )
    db.delete(employee)
    db.flush()


def terminate(
    db: Session,
    *,
    employee_id: int,
    end_date: date,
    kind: TerminationKind,
    actor_user_id: int,
    last_working_day: date | None = None,
    reason: str | None = None,
    settlement_amount=None,
) -> EmployeeTermination:
    emp = db.get(Employee, employee_id)
    if emp is None:
        raise HrError("الموظف غير موجود.")
    if db.scalar(select(EmployeeTermination).where(
            EmployeeTermination.employee_id == employee_id)):
        raise HrError("خروج هذا الموظف مسجّل مسبقاً.")
    if emp.hire_date and end_date < emp.hire_date:
        raise HrError("تاريخ نهاية الخدمة قبل تاريخ التعيين.")
    if last_working_day and last_working_day > end_date:
        raise HrError("آخر يوم عمل بعد تاريخ نهاية الخدمة.")

    row = EmployeeTermination(
        employee_id=employee_id, end_date=end_date, last_working_day=last_working_day,
        kind=kind, reason=reason, settlement_amount=settlement_amount,
        actor_user_id=actor_user_id,
    )
    db.add(row)
    emp.active = False
    db.flush()
    audit_service.record(
        db, action="employee.terminate", actor_user_id=actor_user_id,
        entity_type="employee", entity_id=employee_id,
        after={"end_date": str(end_date), "kind": kind.value},
    )
    return row


def reinstate(db: Session, *, employee_id: int, actor_user_id: int) -> Employee:
    emp = db.get(Employee, employee_id)
    if emp is None:
        raise HrError("الموظف غير موجود.")
    row = db.scalar(select(EmployeeTermination).where(
        EmployeeTermination.employee_id == employee_id))
    if row is None:
        raise HrError("لا توجد نهاية خدمة مسجّلة لهذا الموظف.")
    db.delete(row)
    emp.active = True
    db.flush()
    audit_service.record(
        db, action="employee.reinstate", actor_user_id=actor_user_id,
        entity_type="employee", entity_id=employee_id, after={"active": True},
    )
    return emp
