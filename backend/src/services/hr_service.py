"""الأقسام ونهاية الخدمة — خدمة الموارد البشرية (HR-1).

Plain module functions, `db.flush()` only — the router commits. Every write is audited.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.models.cost_center import CostCenter
from src.models.employee import Employee
from src.models.hr_org import Department, EmployeeTermination, TerminationKind
from src.services import audit_service, numbering


class HrError(Exception):
    """الطلب مايتعملش زي ما هو مكتوب."""


# ------------------------------------------------------------------ الأقسام


def _assert_no_cycle(db: Session, *, department_id: int, parent_id: int | None) -> None:
    """قسم مايبقاش تحت نفسه.

    A department pointed at its own descendant makes the tree a ring, and every walk over it —
    the org chart, the cost roll-up, the report grouping — runs forever. Cheaper to refuse here
    than to discover it when a report hangs.
    """
    seen = {department_id}
    cursor = parent_id
    while cursor is not None:
        if cursor in seen:
            raise HrError("القسم ده هيبقى تحت نفسه.")
        seen.add(cursor)
        node = db.get(Department, cursor)
        cursor = node.parent_id if node else None


def _validate_links(db: Session, *, parent_id, manager_employee_id, cost_center_id, branch_id):
    if parent_id is not None and db.get(Department, parent_id) is None:
        raise HrError("القسم الأب غير موجود.")
    if manager_employee_id is not None and db.get(Employee, manager_employee_id) is None:
        raise HrError("المدير المختار مش موظف موجود.")
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
        raise HrError("فيه قسم بنفس الاسم.")
    wanted = (code or "").strip() or numbering.next_document_number(
        db, Department, "DEP", column=Department.code, width=3
    )
    if db.scalar(select(Department).where(Department.code == wanted)):
        raise HrError("كود القسم مستخدم قبل كده.")
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
            raise HrError("فيه قسم بنفس الاسم.")
        fields["name"] = clean
    if "parent_id" in fields:
        if fields["parent_id"] == department_id:
            raise HrError("القسم ده هيبقى تحت نفسه.")
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
    """بيتقفل، مابيتمسحش — الاسم لازم يفضل مقروء على كل موظف مربوط بيه.

    A department with people still in it stays refused rather than quietly orphaning them: an
    employee whose department is deactivated under him disappears from every grouped report at once
    and nobody is told why.
    """
    dept = db.get(Department, department_id)
    if dept is None:
        raise HrError("القسم غير موجود.")
    inside = db.scalar(select(func.count()).select_from(Employee).where(
        Employee.department_id == department_id, Employee.active.is_(True))) or 0
    if inside:
        raise HrError(f"فيه {inside} موظف نشط في القسم ده — انقلهم الأول.")
    children = db.scalar(select(func.count()).select_from(Department).where(
        Department.parent_id == department_id, Department.active.is_(True))) or 0
    if children:
        raise HrError(f"فيه {children} قسم فرعي شغّال تحته.")

    dept.active = False
    db.flush()
    audit_service.record(
        db, action="department.deactivate", actor_user_id=actor_user_id,
        entity_type="department", entity_id=dept.id, after={"active": False},
    )
    return dept


def import_departments_from_employees(db: Session, *, actor_user_id: int) -> dict:
    """بيحوّل نص «القسم» القديم لأقسام حقيقية ويربط الموظفين بيها.

    An explicit endpoint somebody runs and reads the result of — NOT startup magic. The startup
    hooks in `main.py` swallow their failures at info level, and a half-applied mapping of the
    whole payroll is exactly the kind of thing that must not fail quietly.
    """
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


# ----------------------------------------------------------- نهاية الخدمة


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
    """بيسجّل نهاية الخدمة وبيوقف الموظف.

    Two things, one act. Recording the leaving date without deactivating leaves someone on next
    month's payroll; deactivating without the date leaves «مين مشي الشهر ده» unanswerable.
    """
    emp = db.get(Employee, employee_id)
    if emp is None:
        raise HrError("الموظف غير موجود.")
    if db.scalar(select(EmployeeTermination).where(
            EmployeeTermination.employee_id == employee_id)):
        raise HrError("الموظف ده متسجّل خروجه قبل كده.")
    if emp.hire_date and end_date < emp.hire_date:
        raise HrError("تاريخ نهاية الخدمة قبل تاريخ التعيين.")
    if last_working_day and last_working_day > end_date:
        raise HrError("آخر يوم شغل بعد تاريخ نهاية الخدمة.")

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
    """بيلغي نهاية خدمة اتسجّلت بالغلط ويرجّع الموظف نشط."""
    emp = db.get(Employee, employee_id)
    if emp is None:
        raise HrError("الموظف غير موجود.")
    row = db.scalar(select(EmployeeTermination).where(
        EmployeeTermination.employee_id == employee_id))
    if row is None:
        raise HrError("مافيش نهاية خدمة مسجّلة للموظف ده.")
    db.delete(row)
    emp.active = True
    db.flush()
    audit_service.record(
        db, action="employee.reinstate", actor_user_id=actor_user_id,
        entity_type="employee", entity_id=employee_id, after={"active": True},
    )
    return emp
