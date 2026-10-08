from __future__ import annotations

from contextvars import ContextVar

from sqlalchemy import or_
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser

_view_branch: ContextVar[int | None] = ContextVar("view_branch", default=None)


def set_view_branch(branch_id: int | None):
    return _view_branch.set(branch_id)


def reset_view_branch(token) -> None:
    _view_branch.reset(token)


def visible_branch_id(current: CurrentUser) -> int | None:
    if current.is_admin:
        return _view_branch.get()
    return current.branch_id


def sees_all_branches(current: CurrentUser) -> bool:
    return current.is_admin or current.branch_id is None


def scope(stmt, model, current: CurrentUser):
    branch_id = visible_branch_id(current)
    if branch_id is None:
        return stmt
    return stmt.where(or_(model.branch_id == branch_id, model.branch_id.is_(None)))


def may_see(current: CurrentUser, row) -> bool:
    branch_id = visible_branch_id(current)
    if branch_id is None:
        return True
    row_branch = getattr(row, "branch_id", None)
    return row_branch is None or row_branch == branch_id


def branch_of_warehouse(db: Session, warehouse_id: int | None) -> int | None:
    if not warehouse_id:
        return None
    from src.models.warehouse import Warehouse

    wh = db.get(Warehouse, warehouse_id)
    return wh.branch_id if wh else None


def resolve(db: Session, current: CurrentUser, *, warehouse_id: int | None = None) -> int | None:
    return branch_of_warehouse(db, warehouse_id) or current.branch_id


def branch_for(db: Session, *, actor_user_id: int | None = None,
               location_kind=None, location_id: int | None = None) -> int | None:
    kind = getattr(location_kind, "value", location_kind)
    if location_id:
        if kind == "warehouse":
            from src.models.warehouse import Warehouse

            wh = db.get(Warehouse, location_id)
            if wh and wh.branch_id:
                return wh.branch_id
        elif kind == "rep":
            from src.models.user import User

            rep = db.get(User, location_id)
            if rep and rep.branch_id:
                return rep.branch_id
    if actor_user_id:
        from src.models.user import User

        actor = db.get(User, actor_user_id)
        return actor.branch_id if actor else None
    return None


def visible(current: CurrentUser, rows):
    if visible_branch_id(current) is None:
        return list(rows)
    return [r for r in rows if may_see(current, r)]


def employee_ids(current: CurrentUser):
    branch_id = visible_branch_id(current)
    if branch_id is None:
        return None
    from sqlalchemy import select

    from src.models.employee import Employee

    return select(Employee.id).where(
        or_(Employee.branch_id == branch_id, Employee.branch_id.is_(None)))


def scope_by_employee(stmt, employee_id_column, current: CurrentUser):
    ids = employee_ids(current)
    if ids is None:
        return stmt
    return stmt.where(employee_id_column.in_(ids))


def may_touch_employee(db: Session, current: CurrentUser, employee_id: int | None) -> bool:
    if sees_all_branches(current) or employee_id is None:
        return True
    from src.models.employee import Employee

    emp = db.get(Employee, employee_id)
    return emp is None or emp.branch_id is None or emp.branch_id == current.branch_id
