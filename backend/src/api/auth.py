"""Auth router (T030): POST /auth/login, GET /auth/me. FR-001."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, get_current_user
from src.core.db import get_db
from src.core.security import create_access_token, verify_password
from src.models.role import Role
from src.models.user import User
from src.services import audit_service

router = APIRouter(tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class UserOut(BaseModel):
    id: int
    username: str
    role: str
    full_name: str
    branch_id: int | None
    territory_id: int | None
    active: bool


@router.post("/auth/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    from src.core.config import settings

    user = db.scalar(select(User).where(User.username == body.username))
    if user is None or not user.active or not verify_password(body.password, user.password_hash):
        audit_service.record(
            db,
            action="login.fail",
            actor_user_id=user.id if user else None,
            entity_type="user",
            entity_id=user.id if user else None,
            after={"username": body.username},
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "unauthorized", "message": "Invalid username or password"},
        )
    role = db.get(Role, user.role_id)
    token = create_access_token(
        {
            "sub": str(user.id),
            "role": role.name.value,
            "branch_id": user.branch_id,
            "rep_id": user.id if role.name.value == "sales_rep" else None,
        }
    )
    audit_service.record(
        db, action="login.success", actor_user_id=user.id, entity_type="user", entity_id=user.id
    )
    db.commit()
    return TokenResponse(access_token=token, expires_in=settings.access_token_ttl)


@router.get("/auth/me", response_model=UserOut)
def me(current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> UserOut:
    user = db.get(User, current.id)
    return UserOut(
        id=user.id,
        username=user.username,
        role=current.role.value,
        full_name=user.full_name,
        branch_id=user.branch_id,
        territory_id=user.territory_id,
        active=user.active,
    )
