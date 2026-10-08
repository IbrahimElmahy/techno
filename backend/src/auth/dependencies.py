from __future__ import annotations

from dataclasses import dataclass, field

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from src.auth.rbac import role_has_capability
from src.core.db import get_db
from src.core.security import decode_access_token
from src.models.role import Role, RoleName
from src.models.user import User

_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class CurrentUser:
    id: int
    username: str
    role: RoleName
    branch_id: int | None
    territory_id: int | None
    grants: frozenset = field(default_factory=frozenset)
    denies: frozenset = field(default_factory=frozenset)

    def can(self, capability: str) -> bool:
        if self.role == RoleName.system_admin:
            return role_has_capability(self.role, capability)
        if capability in self.denies:
            return False
        if capability in self.grants:
            return True
        return role_has_capability(self.role, capability)

    @property
    def is_owner(self) -> bool:
        return self.role == RoleName.owner

    @property
    def is_admin(self) -> bool:
        return self.role in (RoleName.system_admin, RoleName.owner)

    @property
    def rep_id(self) -> int | None:
        return self.id if self.role == RoleName.sales_rep else None


def _deny(detail: str, code: int = status.HTTP_403_FORBIDDEN) -> HTTPException:
    return HTTPException(status_code=code, detail={"code": "forbidden", "message": detail})


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> CurrentUser:
    if creds is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "unauthorized", "message": "Missing credentials"},
        )
    payload = decode_access_token(creds.credentials)
    if payload is None or "sub" not in payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "unauthorized", "message": "Invalid token"},
        )
    user = db.get(User, int(payload["sub"]))
    if user is None or not user.active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "unauthorized", "message": "Inactive or unknown user"},
        )
    if user.session_id and payload.get("sid") != user.session_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "session_replaced",
                "message": "تم تسجيل الدخول بهذا الحساب من جهاز آخر — الحساب لجهاز واحد فقط.",
            },
        )
    role = db.get(Role, user.role_id)
    grants, denies = user_overrides(db, user.id)
    return CurrentUser(
        id=user.id,
        username=user.username,
        role=role.name,
        branch_id=user.branch_id,
        territory_id=user.territory_id,
        grants=grants,
        denies=denies,
    )


def user_overrides(db: Session, user_id: int) -> tuple[frozenset, frozenset]:
    from sqlalchemy import select

    from src.models.permission import UserCapability

    rows = db.execute(select(UserCapability.capability, UserCapability.granted)
                      .where(UserCapability.user_id == user_id)).all()
    return (frozenset(c for c, g in rows if g), frozenset(c for c, g in rows if not g))


def require_capability(capability: str):
    def _dep(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if not current.can(capability):
            raise _deny(f"Capability '{capability}' not granted to role '{current.role.value}'.")
        return current

    return _dep


def ensure_branch_access(current: CurrentUser, target_branch_id: int | None) -> None:
    if current.is_admin or current.branch_id is None:
        return
    if current.branch_id != target_branch_id:
        raise _deny("Out-of-branch access denied.")


def ensure_rep_access(current: CurrentUser, target_rep_id: int) -> None:
    if current.role == RoleName.sales_rep and current.id != target_rep_id:
        raise _deny("Rep may access only their own data.")
