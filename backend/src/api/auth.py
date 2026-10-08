from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, get_current_user
from src.auth.rbac import ALL_CAPABILITIES, RoleName, effective_capabilities
from src.core.db import get_db
from src.core import login_guard
from src.core.security import create_access_token, verify_password
from src.models.role import Role
from src.models.user import User
from src.services import audit_service

router = APIRouter(tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str
    client: str | None = None


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
    supervisor_id: int | None = None
    capabilities: list[str] = []
    pages_shown: list[str] = []
    pages_hidden: list[str] = []


@router.post("/auth/login", response_model=TokenResponse)
def login(body: LoginRequest, request: Request,
          db: Session = Depends(get_db)) -> TokenResponse:
    from src.core.config import settings

    ip = login_guard.client_ip(request)
    wait = login_guard.seconds_locked(body.username, ip)
    if wait:
        audit_service.record(
            db, action="login.locked", actor_user_id=None, entity_type="user",
            entity_id=None, after={"username": body.username, "ip": ip},
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "too_many_attempts",
                    "message": f"محاولات دخول كثيرة. انتظر {wait} ثانية ثم أعد المحاولة."},
        )

    user = db.scalar(select(User).where(User.username == body.username))
    if user is None or not user.active or not verify_password(body.password, user.password_hash):
        login_guard.record_failure(body.username, ip)
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
    login_guard.record_success(body.username, ip)
    role = db.get(Role, user.role_id)
    ttl = settings.mobile_token_ttl if body.client == "mobile" else settings.access_token_ttl
    previous_sid = user.session_id
    sid = uuid.uuid4().hex
    user.session_id = sid
    user.session_client = (body.client or "web")[:16]
    user.session_started_at = datetime.now(UTC).replace(tzinfo=None)
    token = create_access_token(
        {
            "sub": str(user.id),
            "sid": sid,
            "role": role.name.value,
            "branch_id": user.branch_id,
            "rep_id": user.id if role.name.value == "sales_rep" else None,
        },
        ttl_seconds=ttl,
    )
    audit_service.record(
        db,
        action="login.success",
        actor_user_id=user.id,
        entity_type="user",
        entity_id=user.id,
        after={"client": user.session_client, "replaced_session": bool(previous_sid)},
    )
    db.commit()
    return TokenResponse(access_token=token, expires_in=ttl)


@router.post("/auth/logout")
def logout(
    current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)
) -> dict[str, bool]:
    user = db.get(User, current.id)
    if user is not None:
        user.session_id = None
        user.session_client = None
        user.session_started_at = None
        audit_service.record(
            db, action="logout", actor_user_id=user.id, entity_type="user", entity_id=user.id
        )
        db.commit()
    return {"ok": True}


@router.post("/auth/refresh", response_model=TokenResponse)
def refresh(
    current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)
) -> TokenResponse:
    from src.core.config import settings

    user = db.get(User, current.id)
    if user is None or not user.active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "unauthorized", "message": "User is not active"},
        )
    role = db.get(Role, user.role_id)
    ttl = settings.access_token_ttl
    token = create_access_token(
        {
            "sub": str(user.id),
            "sid": user.session_id,
            "role": role.name.value,
            "branch_id": user.branch_id,
            "rep_id": user.id if role.name.value == "sales_rep" else None,
        },
        ttl_seconds=ttl,
    )
    return TokenResponse(access_token=token, expires_in=ttl)


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
        supervisor_id=user.supervisor_id,
        capabilities=sorted(ALL_CAPABILITIES if current.role == RoleName.system_admin
                            else (set(effective_capabilities(current.role)) | {
                                c for c in current.grants if not c.startswith("page:")})
                            - set(current.denies)),
        pages_shown=sorted(c[5:] for c in current.grants if c.startswith("page:")),
        pages_hidden=sorted(c[5:] for c in current.denies if c.startswith("page:")),
    )
