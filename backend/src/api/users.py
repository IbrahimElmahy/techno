"""Users router (T031): list/create/get/deactivate. FR-003, FR-006, FR-007."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.api.auth import UserOut
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
    )


@router.get("", response_model=list[UserOut])
def list_users(
    current: CurrentUser = Depends(require_capability(CAP_USER_READ)),
    db: Session = Depends(get_db),
) -> list[UserOut]:
    stmt = select(User)
    if not current.is_admin:  # branch-scoped roles see only their branch (FR-007)
        stmt = stmt.where(User.branch_id == current.branch_id)
    return [_to_out(db, u) for u in db.scalars(stmt).all()]


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    body: UserCreate,
    current: CurrentUser = Depends(require_capability(CAP_USER_WRITE)),
    db: Session = Depends(get_db),
) -> UserOut:
    # Branch-scoped creators may only create within their own branch.
    if not current.is_admin:
        ensure_branch_access(current, body.branch_id)
    # Validate required scope by role.
    if body.role in (RoleName.branch_manager, RoleName.purchasing_manager, RoleName.sales_manager):
        if body.branch_id is None:
            raise HTTPException(422, {"code": "validation", "message": "branch_id required"})
    if body.role == RoleName.sales_rep and (body.branch_id is None or body.territory_id is None):
        raise HTTPException(
            422, {"code": "validation", "message": "sales_rep needs branch_id + territory_id"}
        )

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


@router.post("/{user_id}/deactivate", response_model=UserOut)
def deactivate_user(
    user_id: int,
    current: CurrentUser = Depends(require_capability(CAP_USER_DEACTIVATE)),
    db: Session = Depends(get_db),
) -> UserOut:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, {"code": "not_found", "message": "User not found"})
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
