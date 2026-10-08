from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.api.auth import UserOut
from src.auth import branch_scope
from src.auth.dependencies import (
    CurrentUser,
    ensure_branch_access,
    require_capability,
)
from src.auth.rbac import CAP_USER_DEACTIVATE, CAP_USER_READ, CAP_USER_WRITE
from src.core.db import get_db
from src.core.security import hash_password
from src.models.role import Role, RoleName
from src.models.user import User
from src.services import audit_service

router = APIRouter(tags=["users"], prefix="/users")


class UserCreate(BaseModel):
    username: str
    password: str
    role: RoleName
    full_name: str
    branch_id: int | None = None
    territory_id: int | None = None
    supervisor_id: int | None = None


class UserUpdate(BaseModel):
    username: str | None = Field(default=None, min_length=2, max_length=50)
    full_name: str | None = None
    role: RoleName | None = None
    branch_id: int | None = None
    territory_id: int | None = None
    active: bool | None = None
    password: str | None = None
    supervisor_id: int | None = None


def _check_supervisor(db: Session, supervisor_id: int | None, role,
                      branch_id: int | None) -> int | None:
    name = getattr(role, "value", role)
    if not supervisor_id or name != RoleName.sales_rep.value:
        return None
    sup = db.get(User, supervisor_id)
    sup_role = db.get(Role, sup.role_id) if sup is not None else None
    if sup is None or sup_role is None or sup_role.name != RoleName.rep_supervisor:
        raise HTTPException(422, {"code": "validation",
                                  "message": "المشرف لازم يكون مستخدم دوره «مشرف مناديب»."})
    if sup.branch_id is None or sup.branch_id != branch_id:
        raise HTTPException(422, {"code": "validation",
                                  "message": "المشرف لازم يكون من نفس فرع المندوب."})
    return sup.id


def _to_out(db: Session, user: User) -> UserOut:
    role = db.get(Role, user.role_id)
    return UserOut(
        id=user.id,
        username=user.username,
        role=role.name.value,
        full_name=user.full_name,
        branch_id=user.branch_id,
        territory_id=user.territory_id,
        active=user.active,
        supervisor_id=user.supervisor_id,
    )


@router.get("", response_model=list[UserOut])
def list_users(
    current: CurrentUser = Depends(require_capability(CAP_USER_READ)),
    db: Session = Depends(get_db),
) -> list[UserOut]:
    stmt = select(User)
    scoped_branch = branch_scope.visible_branch_id(current)
    if scoped_branch is not None:
        stmt = stmt.where(User.branch_id == scoped_branch)
    _roles = db.scalars(select(Role)).all()  # noqa: F841
    return [_to_out(db, u) for u in db.scalars(stmt).all()]



def _guard_elevated(current: CurrentUser, target_role) -> None:
    name = getattr(target_role, "value", target_role)
    if name in (RoleName.system_admin.value, RoleName.owner.value) and not current.is_owner:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            {"code": "forbidden",
             "message": "حساب مدير النظام أو المالك مايتعدّلش إلا من المالك."})


BELOW_BRANCH_MANAGER = {
    RoleName.sales_rep, RoleName.sales_manager, RoleName.purchasing_manager,
    RoleName.accountant, RoleName.after_sales_staff, RoleName.viewer,
    RoleName.rep_supervisor,
}


def _guard_role_ceiling(current: CurrentUser, target_role) -> None:
    if current.is_admin:
        return
    name = getattr(target_role, "value", target_role)
    if name not in {r.value for r in BELOW_BRANCH_MANAGER}:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            {"code": "forbidden",
             "message": "مدير الفرع بيدير الأدوار اللي تحته بس — مش مدير فرع ولا أدمن ولا مالك."})


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    body: UserCreate,
    current: CurrentUser = Depends(require_capability(CAP_USER_WRITE)),
    db: Session = Depends(get_db),
) -> UserOut:
    _guard_elevated(current, body.role)
    _guard_role_ceiling(current, body.role)
    if not current.is_admin:
        if body.branch_id is None:
            body.branch_id = current.branch_id
        if body.branch_id != current.branch_id:
            raise HTTPException(403, {"code": "forbidden",
                                      "message": "المستخدم الجديد لازم يبقى على فرعك."})
        ensure_branch_access(current, body.branch_id)
    if body.role in (RoleName.branch_manager, RoleName.purchasing_manager, RoleName.sales_manager,
                     RoleName.rep_supervisor):
        if body.branch_id is None:
            raise HTTPException(422, {"code": "validation", "message": "branch_id required"})
    if body.role == RoleName.sales_rep and (body.branch_id is None or body.territory_id is None):
        raise HTTPException(
            422, {"code": "validation", "message": "sales_rep needs branch_id + territory_id"}
        )

    supervisor_id = _check_supervisor(db, body.supervisor_id, body.role, body.branch_id)
    role = db.scalar(select(Role).where(Role.name == body.role))
    if role is None:
        role = Role(name=body.role)
        db.add(role)
        db.flush()
    user = User(
        username=body.username,
        password_hash=hash_password(body.password),
        role_id=role.id,
        full_name=body.full_name,
        branch_id=body.branch_id,
        territory_id=body.territory_id,
        supervisor_id=supervisor_id,
    )
    db.add(user)
    db.flush()
    audit_service.record(
        db,
        action="user.create",
        actor_user_id=current.id,
        entity_type="user",
        entity_id=user.id,
        after={"username": user.username, "role": body.role.value, "branch_id": body.branch_id},
    )
    db.commit()
    return _to_out(db, user)


@router.get("/{user_id}", response_model=UserOut)
def get_user(
    user_id: int,
    current: CurrentUser = Depends(require_capability(CAP_USER_READ)),
    db: Session = Depends(get_db),
) -> UserOut:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, {"code": "not_found", "message": "User not found"})
    if not current.is_admin:
        ensure_branch_access(current, user.branch_id)
    return _to_out(db, user)


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    body: UserUpdate,
    current: CurrentUser = Depends(require_capability(CAP_USER_WRITE)),
    db: Session = Depends(get_db),
) -> UserOut:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, {"code": "not_found", "message": "User not found"})
    _guard_elevated(current, db.get(Role, user.role_id).name)
    if user.id != current.id:
        _guard_role_ceiling(current, db.get(Role, user.role_id).name)
    if body.role is not None:
        _guard_elevated(current, body.role)
        if body.role != db.get(Role, user.role_id).name:
            _guard_role_ceiling(current, body.role)
    if not current.is_admin:
        ensure_branch_access(current, user.branch_id)
        ensure_branch_access(current, body.branch_id if body.branch_id is not None else user.branch_id)

    new_role = body.role or db.get(Role, user.role_id).name
    branch_id = body.branch_id if body.branch_id is not None else user.branch_id
    territory_id = body.territory_id if body.territory_id is not None else user.territory_id
    if new_role in (RoleName.branch_manager, RoleName.purchasing_manager, RoleName.sales_manager):
        if branch_id is None:
            raise HTTPException(422, {"code": "validation", "message": f"{new_role.value} needs branch_id"})
    if new_role == RoleName.sales_rep and (branch_id is None or territory_id is None):
        raise HTTPException(
            422, {"code": "validation", "message": "sales_rep needs branch_id + territory_id"})

    if body.username is not None:
        uname = body.username.strip()
        if not uname:
            raise HTTPException(422, {"code": "validation",
                                      "message": "اسم المستخدم ماينفعش يبقى فاضي."})
        clash = db.scalar(select(User).where(User.username == uname, User.id != user.id))
        if clash is not None:
            raise HTTPException(409, {"code": "conflict",
                                      "message": f"«{uname}» متاخد لمستخدم تاني."})
        user.username = uname
    if body.role is not None:
        role = db.scalar(select(Role).where(Role.name == body.role))
        if role is None:
            role = Role(name=body.role)
            db.add(role)
            db.flush()
        user.role_id = role.id
    if body.full_name is not None:
        user.full_name = body.full_name
    if body.branch_id is not None:
        user.branch_id = body.branch_id
    if body.territory_id is not None:
        user.territory_id = body.territory_id
    if body.active is not None:
        user.active = body.active
    if body.password:
        user.password_hash = hash_password(body.password)
    if "supervisor_id" in body.model_fields_set:
        user.supervisor_id = _check_supervisor(db, body.supervisor_id, new_role, user.branch_id)
    elif new_role != RoleName.sales_rep:
        user.supervisor_id = None
    elif user.supervisor_id is not None:
        sup = db.get(User, user.supervisor_id)
        if sup is None or sup.branch_id != user.branch_id:
            user.supervisor_id = None
    if new_role == RoleName.rep_supervisor:
        if user.branch_id is None:
            raise HTTPException(422, {"code": "validation",
                                      "message": "مشرف المناديب لازم يبقى على فرع."})
        for rep in db.scalars(select(User).where(User.supervisor_id == user.id,
                                                  User.branch_id != user.branch_id)).all():
            rep.supervisor_id = None
    db.flush()
    audit_service.record(db, action="user.update", actor_user_id=current.id,
                         entity_type="user", entity_id=user.id,
                         after={"role": new_role.value, "active": user.active,
                                "supervisor_id": user.supervisor_id})
    db.commit()
    return _to_out(db, user)


@router.post("/{user_id}/deactivate", response_model=UserOut)
def deactivate_user(
    user_id: int,
    current: CurrentUser = Depends(require_capability(CAP_USER_DEACTIVATE)),
    db: Session = Depends(get_db),
) -> UserOut:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, {"code": "not_found", "message": "User not found"})
    _guard_elevated(current, db.get(Role, user.role_id).name)
    _guard_role_ceiling(current, db.get(Role, user.role_id).name)
    if not current.is_admin:
        ensure_branch_access(current, user.branch_id)
    before = {"active": user.active}
    user.active = False
    db.flush()
    audit_service.record(
        db,
        action="user.deactivate",
        actor_user_id=current.id,
        entity_type="user",
        entity_id=user.id,
        before=before,
        after={"active": False},
    )
    db.commit()
    return _to_out(db, user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    current: CurrentUser = Depends(require_capability(CAP_USER_DEACTIVATE)),
    db: Session = Depends(get_db),
) -> None:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, {"code": "not_found", "message": "المستخدم مش موجود"})
    if user.id == current.id:
        raise HTTPException(
            409, {"code": "self", "message": "مش هتمسح حسابك وانت داخل بيه"})
    _guard_elevated(current, db.get(Role, user.role_id).name)
    _guard_role_ceiling(current, db.get(Role, user.role_id).name)
    if not current.is_admin:
        ensure_branch_access(current, user.branch_id)

    from sqlalchemy import inspect as sa_inspect
    from sqlalchemy import text

    from src.core.db import engine

    blockers: list[str] = []
    insp = sa_inspect(engine)
    for table in insp.get_table_names():
        for fk in insp.get_foreign_keys(table):
            if fk.get("referred_table") != "user":
                continue
            col = fk["constrained_columns"][0]
            if (table, col) == ("user", "supervisor_id"):
                continue
            if (table, col) == ("employee", "user_id"):
                continue
            n = db.execute(text(f'SELECT count(*) FROM "{table}" WHERE {col} = :i'),
                           {"i": user.id}).scalar() or 0
            if n:
                blockers.append(f"{table}.{col}: {n}")
    if blockers:
        raise HTTPException(409, {
            "code": "has_history",
            "message": ("الحساب ده عليه شغل مسجّل فمينفعش يتمسح — "
                        + " · ".join(blockers[:6])
                        + ". استعمل «تعطيل الحساب» بدل المسح."),
        })

    audit_service.record(
        db,
        action="user.delete",
        actor_user_id=current.id,
        entity_type="user",
        entity_id=user.id,
        before={"username": user.username, "full_name": user.full_name,
                "role": getattr(getattr(user.role, "name", user.role), "value",
                                str(getattr(user.role, "name", user.role)))},
    )
    db.execute(text('UPDATE employee SET user_id = NULL WHERE user_id = :i'), {"i": user.id})
    for rep in db.scalars(select(User).where(User.supervisor_id == user.id)).all():
        rep.supervisor_id = None
    db.flush()
    db.delete(user)
    db.commit()
