"""Auth dependencies (T029): identity, capability gate, scope predicates.

FR-002 (server-side), FR-004 (request carries role+scope), FR-010 (server is sole authority),
FR-011 (deny-by-default). Re-checks `active` and current scope on every request so a removed
branch assignment denies mid-session (spec Edge Case).
"""
from __future__ import annotations

from dataclasses import dataclass

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

    @property
    def is_admin(self) -> bool:
        return self.role == RoleName.system_admin

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
    # Re-validate against current DB state every request (active + scope), not just the token.
    if user is None or not user.active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "unauthorized", "message": "Inactive or unknown user"},
        )
    role = db.get(Role, user.role_id)
    return CurrentUser(
        id=user.id,
        username=user.username,
        role=role.name,
        branch_id=user.branch_id,
        territory_id=user.territory_id,
    )


def require_capability(capability: str):
    """Dependency factory: 403 unless the acting role explicitly has the capability."""

    def _dep(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if not role_has_capability(current.role, capability):
            raise _deny(f"Capability '{capability}' not granted to role '{current.role.value}'.")
        return current

    return _dep


# --- Scope predicates (branch isolation + rep isolation) ---

def ensure_branch_access(current: CurrentUser, target_branch_id: int | None) -> None:
    """Branch-scoped roles may only touch their own branch (FR-007). Admin bypasses."""
    if current.is_admin:
        return
    if current.branch_id is None or current.branch_id != target_branch_id:
        raise _deny("Out-of-branch access denied.")


def ensure_rep_access(current: CurrentUser, target_rep_id: int) -> None:
    """A Sales Rep may only touch their own records (FR-009). Admin/branch handled by caller."""
    if current.role == RoleName.sales_rep and current.id != target_rep_id:
        raise _deny("Rep may access only their own data.")
