"""Audit router (T059): GET /audit. FR-031."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_AUDIT_READ
from src.core.db import get_db
from src.models.audit import AuditLogEntry

router = APIRouter(tags=["audit"])


class AuditOut(BaseModel):
    id: int
    actor_user_id: int | None
    action: str
    entity_type: str | None
    entity_id: int | None
    before: dict | None
    after: dict | None
    created_at: datetime


@router.get("/audit", response_model=list[AuditOut])
def list_audit(
    actor_user_id: int | None = None,
    action: str | None = None,
    entity_type: str | None = None,
    _: CurrentUser = Depends(require_capability(CAP_AUDIT_READ)),
    db: Session = Depends(get_db),
) -> list[AuditOut]:
    stmt = select(AuditLogEntry)
    if actor_user_id is not None:
        stmt = stmt.where(AuditLogEntry.actor_user_id == actor_user_id)
    if action is not None:
        stmt = stmt.where(AuditLogEntry.action == action)
    if entity_type is not None:
        stmt = stmt.where(AuditLogEntry.entity_type == entity_type)
    return [
        AuditOut(
            id=a.id, actor_user_id=a.actor_user_id, action=a.action,
            entity_type=a.entity_type, entity_id=a.entity_id,
            before=a.before_json, after=a.after_json, created_at=a.created_at,
        )
        for a in db.scalars(stmt).all()
    ]
